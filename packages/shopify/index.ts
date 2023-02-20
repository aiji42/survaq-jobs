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
  updateShopifyProductGroups,
  getFundingsByProductGroup,
} from "@survaq-jobs/libraries";
import { createClient as createShopifyClient } from "./shopify";
import { storage } from "./cloud-storage";
import { parse } from "csv-parse/sync";

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
  products(first: 50, query: "${query}" after: ${
  cursor ? `"${cursor}"` : "null"
}) {
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
      .map(({ id, title, ShopifyProducts }) => ({
        id: String(id),
        title: title as string,
        productIds: Array.isArray(ShopifyProducts)
          ? ShopifyProducts.map(
              ({ productId }) => `gid://shopify/Product/${productId}`
            )
          : [],
      })) ?? [];

  const currentSyncedAt = new Date().toISOString();
  const lastSyncedAt = await getLatestTimeAt("products", "shopify", "syncedAt");
  const query = `updated_at:>'${lastSyncedAt}'`;
  console.log("Graphql query: ", query);
  let hasNext = true;
  let cursor: null | string = null;
  let products: Product[] = [];
  while (hasNext) {
    const data: { products: WithPageInfo<EdgesNode<ProductNode>> } =
      await shopify.graphql(productListQuery(query, cursor));
    hasNext = data.products.pageInfo.hasNextPage;

    data.products.edges.forEach((edge) => {
      products.push({
        ...edge.node,
        productGroupId: null,
        productGroupName: null,
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
      products
    );
  }

  // TODO: クエリの発行を1回にできないか
  if (productIdAndGroupMappings.length) {
    for (const productIdAndGroup of productIdAndGroupMappings) {
      console.log("update products group mapping:", productIdAndGroup.title);
      await updateRecords(
        "products",
        "shopify",
        {
          productGroupId: productIdAndGroup.id,
          productGroupName: productIdAndGroup.title,
        },
        "id",
        productIdAndGroup.productIds
      );
    }
  }
};

const variantListQuery = (query: string, cursor: null | string) => `{
  productVariants(first: 50, query: "${query}", after: ${
  cursor ? `"${cursor}"` : "null"
}) {
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
  const query = `updated_at:>'${await getLatestTimeAt(
    "variants",
    "shopify",
    "updated_at"
  )}'`;
  console.log("Graphql query: ", query);
  let hasNext = true;
  let cursor: null | string = null;
  let variants: VariantRecord[] = [];
  while (hasNext) {
    const data: { productVariants: WithPageInfo<EdgesNode<VariantListNode>> } =
      await shopify.graphql(variantListQuery(query, cursor));
    hasNext = data.productVariants.pageInfo.hasNextPage;

    variants = data.productVariants.edges.reduce<VariantRecord[]>(
      (res, { node, cursor: c }) => {
        cursor = c;
        return [
          ...res,
          {
            ...node,
            product_id: node.product.id,
            price: Number(node.price),
            compare_at_price: node.compareAtPrice
              ? Number(node.compareAtPrice)
              : null,
          },
        ];
      },
      variants
    );

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
      variants
    );
  }
};

const orderListQuery = (query: string, cursor: null | string) => `{
  orders(first: 10, query: "${query}" after: ${
  cursor ? `"${cursor}"` : "null"
}) {
    edges {
      node {
        id
        name
        display_financial_status: displayFinancialStatus
        display_fulfillment_status: displayFulfillmentStatus
        closed
        totalPriceSet {
          shopMoney {
            amount
          }
        }
        subtotalPriceSet {
          shopMoney {
            amount
          }
        }
        totalTaxSet {
          shopMoney {
            amount
          }
        }
        taxes_included: taxesIncluded
        subtotal_line_item_quantity: subtotalLineItemsQuantity
        closed_at: closedAt
        cancelled_at: cancelledAt
        created_at: createdAt
        updated_at: updatedAt
        lineItems(first: 10) {
          edges {
            node {
              id
              name
              quantity
              originalTotalSet {
                shopMoney {
                  amount
                }
              }
              variant {
                id
                title
              }
              product {
                id
              }
              customAttributes {
                key
                value
              }
            }
          }
        }
        customerJourneySummary {
          firstVisit {
            landingPage
            referrerUrl
            source
            sourceType
            utmParameters {
              source
              medium
              campaign
              content
              term
            }
          }
        }
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
  }
}`;

type ShopMoney = {
  shopMoney: {
    amount: number;
  };
};

type LineItemNode = {
  id: string;
  name: string;
  quantity: number;
  originalTotalSet: ShopMoney;
  variant: {
    id: string;
    title: string;
  };
  product: {
    id: string;
  };
  customAttributes: {
    key: string;
    value: string;
  }[];
};

type LineItemRecord = Omit<
  LineItemNode,
  "originalTotalSet" | "variant" | "product" | "customAttributes"
> & {
  order_id: string;
  product_id: string;
  variant_id: string | null;
  original_total_price: number;
  delivery_schedule: string | null;
  skus: string | null;
};

type OrderNode = {
  id: string;
  name: string;
  lineItems: EdgesNode<LineItemNode>;
  customerJourneySummary?: {
    firstVisit?: {
      landingPage?: string;
      referrerUrl?: string;
      source?: string;
      sourceType?: string;
      utmParameters?: {
        source?: string;
        medium?: string;
        campaign?: string;
        content?: string;
        term?: string;
      };
    };
  };
  display_financial_status: string;
  display_fulfillment_status: string;
  closed: boolean;
  totalPriceSet: ShopMoney;
  subtotalPriceSet: ShopMoney;
  totalTaxSet: ShopMoney;
  taxes_included: boolean;
  subtotal_line_item_quantity: number;
  closed_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type OrderRecord = Omit<
  OrderNode,
  | "lineItems"
  | "customerJourneySummary"
  | "totalPriceSet"
  | "subtotalPriceSet"
  | "totalTaxSet"
> & {
  total_price: number;
  subtotal_price: number;
  total_tax: number;
  landing_page: string | null;
  referrer_url: string | null;
  source: string | null;
  source_type: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

type CustomVisit = {
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

export const ordersAndLineItems = async (): Promise<void> => {
  const query = `updated_at:>'${await getLatestTimeAt(
    "orders",
    "shopify",
    "updated_at"
  )}'`;
  console.log("Graphql query: ", query);

  let hasNext = true;
  let cursor: null | string = null;
  let orders: OrderRecord[] = [];
  let lineItems: LineItemRecord[] = [];

  while (hasNext) {
    const data: { orders: WithPageInfo<EdgesNode<OrderNode>> } =
      await shopify.graphql(orderListQuery(query, cursor));

    hasNext = data.orders.pageInfo.hasNextPage;

    const customVisitByOrder: Record<string, CustomVisit> = {};

    lineItems = [
      ...lineItems,
      ...data.orders.edges.flatMap(({ node }) => {
        return node.lineItems.edges.map(({ node: item }) => {
          const customVisit: CustomVisit = {
            source: null,
            utm_source: null,
            utm_medium: null,
            utm_campaign: null,
            utm_content: null,
            utm_term: null,
          };
          item.customAttributes.forEach(({ key, value }) => {
            if (!value) return;
            if (key === "_source") customVisit.source = value;
            if (key === "_utm_source") customVisit.utm_source = value;
            if (key === "_utm_medium") customVisit.utm_medium = value;
            if (key === "_utm_campaign") customVisit.utm_campaign = value;
            if (key === "_utm_content") customVisit.utm_content = value;
            if (key === "_utm_term") customVisit.utm_term = value;
          });
          customVisitByOrder[node.id] = customVisit;
          return {
            ...item,
            order_id: node.id,
            product_id: item.product.id,
            variant_id: item.variant?.id ?? null,
            original_total_price: Number(
              item.originalTotalSet.shopMoney.amount
            ),
            delivery_schedule: null,
            skus: null,
          };
        });
      }),
    ];

    orders = [
      ...orders,
      ...data.orders.edges.map(({ node, cursor: c }) => {
        cursor = c;
        const visit = node.customerJourneySummary?.firstVisit;
        const utmSource = decode(visit?.utmParameters?.source);
        return {
          ...node,
          total_price: Number(node.totalPriceSet.shopMoney.amount),
          subtotal_price: Number(node.subtotalPriceSet.shopMoney.amount),
          total_tax: Number(node.totalTaxSet.shopMoney.amount),
          landing_page: visit?.landingPage ?? null,
          referrer_url: visit?.referrerUrl ?? null,
          source:
            (visit?.source === "an unknown source"
              ? utmSource
              : visit?.source) ??
            customVisitByOrder[node.id]?.source ??
            null,
          source_type: visit?.sourceType ?? null,
          utm_source:
            utmSource ?? customVisitByOrder[node.id]?.utm_source ?? null,
          utm_medium:
            decode(visit?.utmParameters?.medium) ??
            decode(customVisitByOrder[node.id]?.utm_medium) ??
            null,
          utm_campaign:
            decode(visit?.utmParameters?.campaign) ??
            decode(customVisitByOrder[node.id]?.utm_campaign) ??
            null,
          utm_content:
            decode(visit?.utmParameters?.content) ??
            decode(customVisitByOrder[node.id]?.utm_content) ??
            null,
          utm_term:
            decode(visit?.utmParameters?.term) ??
            decode(customVisitByOrder[node.id]?.utm_term) ??
            null,
        };
      }),
    ];

    if (hasNext) {
      console.log("has next cursor: ", cursor);
      await sleep(5);
    }
  }

  for (const items of sliceByNumber(orders, 200)) {
    if (items.length < 1) continue;
    console.log("orders records:", items.length);
    await deleteByField(
      "orders",
      "shopify",
      "id",
      items.map(({ id }) => id)
    );
    await insertRecords(
      "orders",
      "shopify",
      [
        "id",
        "name",
        "display_financial_status",
        "display_fulfillment_status",
        "closed",
        "total_price",
        "subtotal_price",
        "total_tax",
        "taxes_included",
        "subtotal_line_item_quantity",
        "closed_at",
        "cancelled_at",
        "created_at",
        "updated_at",
        "landing_page",
        "referrer_url",
        "source",
        "source_type",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
      ],
      items
    );
  }
  for (const items of sliceByNumber(lineItems, 200)) {
    if (items.length < 1) continue;
    console.log("line_items records:", items.length);
    await deleteByField(
      "line_items",
      "shopify",
      "id",
      items.map(({ id }) => id)
    );
    await insertRecords(
      "line_items",
      "shopify",
      [
        "id",
        "name",
        "order_id",
        "variant_id",
        "product_id",
        "quantity",
        "original_total_price",
        "delivery_schedule",
        "skus",
      ],
      items
    );
  }
};

export const smartShoppingPerformance = async () => {
  const bucket = storage.bucket("smart-shopping-performance-csv");
  const [files] = await bucket.getFiles();
  const rows = (
    await Promise.all(
      files.map((file) =>
        file.download().then(([bff]) => parse(bff.toString(), { from_line: 4 }))
      )
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
      return [
        ...res,
        { date, merchantCenterId, name, currencyCode, cost: Number(cost) },
      ];
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
      rows
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
      }))
    );
  }
};

const fundingsOnCMS = async () => {
  const data = await getShopifyProductGroups();
  const fundings = await getFundingsByProductGroup();
  await Promise.all(
    data.map(async ({ id, title }) => {
      const funding = fundings.find(
        ({ productGroupId }) => String(id) === productGroupId
      );
      if (funding) {
        console.log("update fundings:", title);
        await updateShopifyProductGroups(id, {
          realTotalPrice: funding.totalPrice,
          realSupporters: funding.supporters,
        });
      }
    })
  );
};

const decode = <T extends string | null | undefined>(src: T): T => {
  if (typeof src !== "string") return src;
  try {
    return decodeURI(src) as T;
  } catch (_) {
    return src;
  }
};

const main = async () => {
  console.log("Sync products and variants");
  await Promise.all([products(), variants()]);
  console.log("Sync orders and lineItems");
  await ordersAndLineItems();
  console.log("Sync smart shopping performance");
  await smartShoppingPerformance();
  console.log("Sync fundings on cms");
  await fundingsOnCMS();
};
main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
