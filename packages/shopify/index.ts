import {
  insertRecords,
  deleteByField,
  getLatestTimeAt,
  sliceByNumber,
  sleep,
  updateRecords,
  truncateTable,
  getShopifyProductGroups,
  getGoogleMerchantCenter,
  updateSku,
  getAllSkus,
  calcSKUDeliveryScheduleDaysGap,
} from "@survaq-jobs/libraries";
import { createClient as createShopifyClient } from "./shopify";
import { storage } from "./cloud-storage";
import { parse } from "csv-parse/sync";
import { getShippedCounts } from "./sku";

type EdgesNode<T> = {
  edges: {
    node: T;
    cursor: string;
  }[];
};

type WithPageInfo<T> = T & {
  pageInfo: {
    hasNextPage: boolean;
  };
};

const shopify = createShopifyClient();

const productListQuery = (query: string, cursor: null | string) => `{
  products(first: 50, query: "${query}" after: ${cursor ? `"${cursor}"` : "null"}) {
    edges {
      node {
        id
        title
        status
        created_at: createdAt
        updated_at: updatedAt
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
  }
}`;

type ProductNode = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type Product = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  productGroupId: string | null;
  productGroupName: string | null;
  syncedAt: string;
};

export const products = async (): Promise<void> => {
  const groups = await getShopifyProductGroups();
  const productIdAndGroupMappings =
    groups
      ?.filter(({ title }) => !!title)
      .map(({ id, title, ShopifyProducts, updatedAt }) => ({
        id: String(id),
        title: title as string,
        updatedAt,
        productIds: ShopifyProducts.map(({ productId }) => `gid://shopify/Product/${productId}`),
      })) ?? [];

  const currentSyncedAt = new Date().toISOString();
  const lastSyncedAt = await getLatestTimeAt("products", "shopify", "syncedAt");
  const query = `updated_at:>'${lastSyncedAt}'`;
  console.log("Graphql query: ", query);
  let hasNext = true;
  let cursor: null | string = null;
  let products: Product[] = [];
  while (hasNext) {
    const data: { products: WithPageInfo<EdgesNode<ProductNode>> } = await shopify.graphql(
      productListQuery(query, cursor),
    );
    hasNext = data.products.pageInfo.hasNextPage;

    data.products.edges.forEach((edge) => {
      cursor = edge.cursor;
      const group = productIdAndGroupMappings.find(({ productIds }) =>
        productIds.includes(edge.node.id),
      );
      products.push({
        ...edge.node,
        productGroupId: group?.id ?? null,
        productGroupName: group?.title ?? null,
        syncedAt: currentSyncedAt,
      });
    });

    if (hasNext) {
      console.log("has next cursor: ", cursor);
      await sleep(1);
    }
  }

  console.log("products records:", products.length);
  if (products.length > 0) {
    const ids = products.map(({ id }) => id);
    await deleteByField("products", "shopify", "id", ids);
    await insertRecords(
      "products",
      "shopify",
      [
        "id",
        "title",
        "status",
        "created_at",
        "updated_at",
        "productGroupId",
        "productGroupName",
        "syncedAt",
      ],
      products,
    );
  }

  for (const productIdAndGroup of productIdAndGroupMappings) {
    if (
      (productIdAndGroup.updatedAt && productIdAndGroup.updatedAt < new Date(lastSyncedAt)) ||
      productIdAndGroup.productIds.length < 1
    )
      continue;
    console.log("update products group mapping:", productIdAndGroup.title);
    await updateRecords(
      "products",
      "shopify",
      {
        productGroupId: productIdAndGroup.id,
        productGroupName: productIdAndGroup.title,
      },
      "id",
      productIdAndGroup.productIds,
    );
  }
};

const variantListQuery = (query: string, cursor: null | string) => `{
  productVariants(first: 50, query: "${query}", after: ${cursor ? `"${cursor}"` : "null"}) {
    edges {
      node {
        id
        title
        display_name: displayName
        price
        compareAtPrice
        taxable
        available_for_sale: availableForSale
        product {
          id
        }
        created_at: createdAt
        updated_at: updatedAt
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
  }
}`;

type VariantListNode = {
  id: string;
  title: string;
  display_name: string;
  price: string;
  compareAtPrice: string;
  taxable: boolean;
  available_for_sale: boolean;
  product: {
    id: string;
  };
  created_at: string;
  updated_at: string;
};

type VariantRecord = {
  id: string;
  title: string;
  display_name: string;
  price: number;
  compare_at_price: number | null;
  taxable: boolean;
  available_for_sale: boolean;
  product_id: string;
  created_at: string;
  updated_at: string;
};

export const variants = async (): Promise<void> => {
  const query = `updated_at:>'${await getLatestTimeAt("variants", "shopify", "updated_at")}'`;
  console.log("Graphql query: ", query);
  let hasNext = true;
  let cursor: null | string = null;
  let variants: VariantRecord[] = [];
  while (hasNext) {
    const data: { productVariants: WithPageInfo<EdgesNode<VariantListNode>> } =
      await shopify.graphql(variantListQuery(query, cursor));
    hasNext = data.productVariants.pageInfo.hasNextPage;

    variants = data.productVariants.edges.reduce<VariantRecord[]>((res, { node, cursor: c }) => {
      cursor = c;
      return [
        ...res,
        {
          ...node,
          product_id: node.product.id,
          price: Number(node.price),
          compare_at_price: node.compareAtPrice ? Number(node.compareAtPrice) : null,
        },
      ];
    }, variants);

    if (hasNext) {
      console.log("has next cursor: ", cursor);
      await sleep(1);
    }
  }

  console.log("variants records:", variants.length);
  if (variants.length > 0) {
    const ids = variants.map(({ id }) => id);
    await deleteByField("variants", "shopify", "id", ids);
    await insertRecords(
      "variants",
      "shopify",
      [
        "id",
        "product_id",
        "title",
        "display_name",
        "price",
        "compare_at_price",
        "taxable",
        "available_for_sale",
        "created_at",
        "updated_at",
      ],
      variants,
    );
  }
};

export const smartShoppingPerformance = async () => {
  const bucket = storage.bucket("smart-shopping-performance-csv");
  const [files] = await bucket.getFiles();
  const rows = (
    await Promise.all(
      files.map((file) => file.download().then(([bff]) => parse(bff.toString(), { from_line: 4 }))),
    )
  )
    .flat()
    .reduce<
      {
        date: string;
        merchantCenterId: string;
        name: string;
        currencyCode: string;
        cost: number;
      }[]
    >((res, [date, merchantCenterId, name, currencyCode, cost]) => {
      if (merchantCenterId === " --") return res;
      return [...res, { date, merchantCenterId, name, currencyCode, cost: Number(cost) }];
    }, []);
  const dates = [...new Set(rows.map(({ date }) => date))];

  if (dates.length > 0) {
    console.log("delete merchant_center.performances date: ", dates);
    await deleteByField("performances", "merchant_center", "date", dates);
  }
  if (rows.length > 0) {
    console.log("insert merchant_center.performances", rows.length, "records");
    await insertRecords(
      "performances",
      "merchant_center",
      ["date", "merchantCenterId", "name", "currencyCode", "cost"],
      rows,
    );
  }

  if (!process.env["DRY_RUN"]) await Promise.all(files.map((f) => f.delete()));

  const mcMapping = await getGoogleMerchantCenter();

  if (mcMapping.length > 0) {
    console.log("delete merchant_center.mappings all records");
    await truncateTable("mappings", "merchant_center");
    console.log("insert merchant_center.mappings", mcMapping.length, "records");
    await insertRecords(
      "mappings",
      "merchant_center",
      ["feedId", "productGroupId"],
      mcMapping.map(({ merchantCenterId, shopifyProductGroup }) => ({
        feedId: merchantCenterId,
        productGroupId: String(shopifyProductGroup),
      })),
    );
  }
};

const updateInventories = async () => {
  const skusOnDB = await getAllSkus();
  const shippedCounts = await getShippedCounts(
    skusOnDB.map(({ code, lastSyncedAt }) => ({
      code,
      shippedAt: lastSyncedAt?.toISOString() ?? "2023-03-01",
    })),
  );

  for (const sku of skusOnDB) {
    const { count: shippedCount = 0, lastShippedAt } =
      shippedCounts.find(({ code }) => code === sku.code) ?? {};

    const lastSyncedAt = lastShippedAt?.value ?? sku.lastSyncedAt;
    const inventory = sku.inventory - shippedCount;

    if (sku.inventory !== inventory || sku.lastSyncedAt !== lastSyncedAt) {
      console.log("update sku:", sku.code);

      await updateSku(sku.code, {
        inventory,
        lastSyncedAt,
      });
    }
  }
};

const skuDeliveryScheduleGap = async () => {
  const gaps = await calcSKUDeliveryScheduleDaysGap();
  // BigQueryに格納する前に同じ日のデータを削除
  await deleteByField("sku_delivery_gaps", "shopify", "date", [
    ...new Set(gaps.map(({ date }) => date)),
  ]);

  console.log("sku_delivery_gaps records:", gaps.length);
  // 100件ずつに分割してBigQueryに格納
  for (const items of sliceByNumber(gaps, 100)) {
    await insertRecords(
      "sku_delivery_gaps",
      "shopify",
      ["code", "date", "schedule", "days"],
      items,
    );
  }
};

const main = async () => {
  console.log("Sync products and variants");
  await Promise.all([products(), variants()]);
  console.log("Update inventories");
  await updateInventories();
  console.log("Sync smart shopping performance");
  await smartShoppingPerformance();
  console.log("Calc sku delivery schedule gap");
  await skuDeliveryScheduleGap();
};
main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
