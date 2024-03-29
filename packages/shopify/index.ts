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
  postMessage,
  MessageAttachment,
  getAllSkus,
  getAllVariationSKUData,
  getAllProducts,
  getAllDuplicatedInventorySKUs,
  calcSKUDeliveryScheduleDaysGap,
} from "@survaq-jobs/libraries";
import { createClient as createShopifyClient } from "./shopify";
import { storage } from "./cloud-storage";
import { parse } from "csv-parse/sync";
import {
  cmsSKULink,
  getPendingShipmentCounts,
  getShippedCounts,
  updatableInventoryOrdersAndNextInventoryOrder,
} from "./sku";
import { cmsProductLink, cmsVariationLink } from "./productAndVariation";

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

const notifySlackChannel = "#notify-cms";

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
      .map(({ id, title, ShopifyProducts, updatedAt }) => ({
        id: String(id),
        title: title as string,
        updatedAt,
        productIds: ShopifyProducts.map(
          ({ productId }) => `gid://shopify/Product/${productId}`,
        ),
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
      (productIdAndGroup.updatedAt &&
        productIdAndGroup.updatedAt < new Date(lastSyncedAt)) ||
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
    "updated_at",
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
      variants,
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
      variants,
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
        note
        customAttributes {
          key
          value
        }
        display_financial_status: displayFinancialStatus
        display_fulfillment_status: displayFulfillmentStatus
        fulfillments {
          createdAt
          fulfillmentLineItems(first: 5) {
            edges {
              node {
                lineItem {
                  id
                }
              }
            }
          }
        }
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
        totalShippingPriceSet {
          shopMoney {
            amount
          }
        }
        totalTaxSet {
          shopMoney {
            amount
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
          }
        }
        totalRefundedShippingSet {
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
        lineItems(first: 5) {
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
              taxLines(first: 1) {
                priceSet {
                  shopMoney {
                    amount
                  }
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

type TaxLine = {
  priceSet: ShopMoney;
};

type LineItemNode = {
  id: string;
  name: string;
  quantity: number;
  originalTotalSet: ShopMoney;
  taxLines: TaxLine[];
  variant?: {
    id: string;
    title: string;
  } | null;
  product?: {
    id: string;
  };
  customAttributes: {
    key: string;
    value: string;
  }[];
};

type LineItemRecord = Omit<
  LineItemNode,
  "originalTotalSet" | "variant" | "product" | "customAttributes" | "taxLines"
> & {
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  original_total_price: number;
  tax_price: number;
  without_tax_total_price: number;
  delivery_schedule: string | null;
  skus: string | null;
};

type OrderNode = {
  id: string;
  name: string;
  note: string | null;
  customAttributes: Array<{ key: string; value: string }>;
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
  fulfillments: Fulfillment[];
  closed: boolean;
  totalPriceSet: ShopMoney;
  subtotalPriceSet: ShopMoney;
  totalShippingPriceSet: ShopMoney;
  totalTaxSet: ShopMoney;
  totalRefundedSet: ShopMoney;
  totalRefundedShippingSet: ShopMoney;
  taxes_included: boolean;
  subtotal_line_item_quantity: number;
  closed_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type Fulfillment = {
  createdAt: string;
  fulfillmentLineItems: EdgesNode<{ lineItem: Pick<LineItemNode, "id"> }>;
};

type OrderRecord = Omit<
  OrderNode,
  | "customAttributes"
  | "lineItems"
  | "customerJourneySummary"
  | "totalPriceSet"
  | "subtotalPriceSet"
  | "totalShippingPriceSet"
  | "totalTaxSet"
  | "totalRefundedSet"
  | "totalRefundedShippingSet"
  | "fulfillments"
> & {
  total_price: number;
  subtotal_price: number;
  without_tax_total_price: number;
  total_shopping_price: number;
  total_tax: number;
  total_refunded_price: number;
  total_refunded_shipping_price: number;
  landing_page: string | null;
  referrer_url: string | null;
  source: string | null;
  source_type: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fulfilled_at: string | null;
};

type CustomVisit = {
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

type OderSkuRecord = {
  code: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  line_item_id: string;
  ordered_at: string;
  fulfilled_at: string | null;
  canceled_at: string | null;
  closed_at: string | null;
  quantity: number;
};

export const ordersAndLineItems = async (): Promise<void> => {
  const query = `updated_at:>'${await getLatestTimeAt(
    "orders",
    "shopify",
    "updated_at",
  )}'`;
  console.log("Graphql query: ", query);

  let hasNext = true;
  let cursor: null | string = null;
  let orders: OrderRecord[] = [];
  let lineItems: LineItemRecord[] = [];
  // 最終的に sliceByNumber して、oder_id で消すので、sliceした結果でoderが跨がらないようにする
  let orderSkus: OderSkuRecord[][] = [];

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
            product_id: item.product?.id ?? null,
            variant_id: item.variant?.id ?? null,
            original_total_price: Number(
              item.originalTotalSet.shopMoney.amount,
            ),
            tax_price: Number(item.taxLines[0]?.priceSet.shopMoney.amount ?? 0),
            without_tax_total_price:
              Number(item.originalTotalSet.shopMoney.amount) -
              Number(item.taxLines[0]?.priceSet.shopMoney.amount ?? 0),
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
          total_shopping_price: Number(
            node.totalShippingPriceSet.shopMoney.amount,
          ),
          without_tax_total_price:
            Number(node.totalPriceSet.shopMoney.amount) -
            Number(node.totalTaxSet.shopMoney.amount),
          total_tax: Number(node.totalTaxSet.shopMoney.amount),
          total_refunded_price: Number(node.totalRefundedSet.shopMoney.amount),
          total_refunded_shipping_price: Number(
            node.totalRefundedShippingSet.shopMoney.amount,
          ),
          landing_page: visit?.landingPage ?? null,
          referrer_url: visit?.referrerUrl ?? null,
          fulfilled_at: node.fulfillments[0]?.createdAt ?? null,
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

    orderSkus = [
      ...orderSkus,
      ...data.orders.edges.map(({ node }) => {
        const { value = "[]" } =
          node.customAttributes.find(({ key }) => key === "__line_items") ?? {};
        const skusByLineItemId = Object.fromEntries(
          (
            JSON.parse(value) as Array<{
              id: number;
              name: string;
              _skus: string[];
            }>
          ).map(({ id, _skus }) => [`gid://shopify/LineItem/${id}`, _skus]),
        );

        return node.lineItems.edges.flatMap(({ node: item }) => {
          const skus = skusByLineItemId[item.id] ?? [];
          const quantityBySku = skus.reduce<Record<string, number>>(
            (res, sku) => {
              return { ...res, [sku]: (res[sku] ?? 0) + 1 };
            },
            {},
          );

          const fulfilledAt = node.fulfillments.find(
            ({ fulfillmentLineItems: { edges } }) =>
              edges.some(
                ({
                  node: {
                    lineItem: { id },
                  },
                }) => id === item.id,
              ),
          )?.createdAt;

          return Object.entries(quantityBySku).map(([sku, qty]) => ({
            code: sku,
            order_id: node.id,
            product_id: item.product?.id ?? null,
            variant_id: item.variant?.id ?? null,
            line_item_id: item.id,
            ordered_at: node.created_at ?? new Date().toISOString(),
            fulfilled_at: fulfilledAt ?? null,
            canceled_at: node.cancelled_at,
            closed_at: node.closed_at,
            quantity: item.quantity * qty,
          }));
        });
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
      items.map(({ id }) => id),
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
        "total_shopping_price",
        "total_refunded_price",
        "total_refunded_shipping_price",
        "without_tax_total_price",
        "total_tax",
        "taxes_included",
        "subtotal_line_item_quantity",
        "closed_at",
        "cancelled_at",
        "created_at",
        "updated_at",
        "fulfilled_at",
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
      items,
    );
  }
  for (const items of sliceByNumber(lineItems, 200)) {
    if (items.length < 1) continue;
    console.log("line_items records:", items.length);
    await deleteByField(
      "line_items",
      "shopify",
      "id",
      items.map(({ id }) => id),
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
        "tax_price",
        "without_tax_total_price",
        "delivery_schedule",
        "skus",
      ],
      items,
    );
  }

  // order_id を使って消すので、sliceByNumberしたときに、order_idがループ間で跨がらない等に、orderごとにまとめてある
  for (const orderSkuGroups of sliceByNumber(orderSkus, 100)) {
    const items = orderSkuGroups.flat();
    if (items.length < 1) continue;
    console.log("order_sku records:", items.length);
    await deleteByField(
      "order_skus",
      "shopify",
      "order_id",
      items.map(({ order_id }) => order_id),
    );
    await insertRecords(
      "order_skus",
      "shopify",
      [
        "code",
        "order_id",
        "line_item_id",
        "product_id",
        "variant_id",
        "ordered_at",
        "fulfilled_at",
        "canceled_at",
        "closed_at",
        "quantity",
      ],
      items,
    );
  }
};

export const smartShoppingPerformance = async () => {
  const bucket = storage.bucket("smart-shopping-performance-csv");
  const [files] = await bucket.getFiles();
  const rows = (
    await Promise.all(
      files.map((file) =>
        file
          .download()
          .then(([bff]) => parse(bff.toString(), { from_line: 4 })),
      ),
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

const skuScheduleShift = async () => {
  const notifies: MessageAttachment[] = [];
  const skusOnDB = await getAllSkus();
  const pendingShipmentCounts = await getPendingShipmentCounts(
    skusOnDB.map(({ code }) => code),
  );
  const shippedCounts = await getShippedCounts(
    skusOnDB.map(({ code, lastSyncedAt }) => ({
      code,
      shippedAt: lastSyncedAt?.toISOString() ?? "2023-03-01",
    })),
  );

  for (const sku of skusOnDB) {
    const unshippedOrderCount =
      pendingShipmentCounts.find(({ code }) => code === sku.code)?.count ?? 0;
    const { count: shippedCount = 0, lastShippedAt } =
      shippedCounts.find(({ code }) => code === sku.code) ?? {};
    const lastSyncedAt = lastShippedAt?.value ?? sku.lastSyncedAt;

    // 出荷台数を実在庫数から引く(=最新の在庫数)
    const inventory = sku.inventory - shippedCount;
    if (inventory < 0) {
      notifies.push({
        title: sku.code,
        title_link: cmsSKULink(sku.id),
        text: "在庫数がマイナスになっています",
        color: "danger",
        fields: [{ title: "inventory", value: String(inventory) }],
      });
    }

    try {
      const { updatableInventoryOrders, nextInventoryOrder, rest } =
        updatableInventoryOrdersAndNextInventoryOrder(
          inventory,
          unshippedOrderCount,
          sku,
        );

      if (
        sku.inventory !== inventory ||
        sku.unshippedOrderCount !== unshippedOrderCount ||
        sku.lastSyncedAt !== lastSyncedAt ||
        sku.currentInventoryOrderSKUId !== nextInventoryOrder.id ||
        updatableInventoryOrders.length
      ) {
        console.log("update sku:", sku.code);

        if (sku.currentInventoryOrderSKUId !== nextInventoryOrder.id)
          notifies.push({
            title: sku.code,
            title_link: cmsSKULink(sku.id),
            text: "下記SKUの販売枠を変更しました",
            color: "good",
            fields: [
              { title: "新しい販売枠", value: nextInventoryOrder.title },
            ],
          });

        await updateSku(sku.code, {
          inventory,
          unshippedOrderCount,
          lastSyncedAt,
          currentInventoryOrderSKU: {
            ...(nextInventoryOrder.id
              ? { connect: { id: nextInventoryOrder.id } }
              : { disconnect: true }),
          },
          inventoryOrderSKUs: {
            update: updatableInventoryOrders.map(({ id, heldQuantity }) => ({
              where: { id },
              data: { heldQuantity },
            })),
          },
        });

        if (rest > 0)
          throw new Error(
            "発注データが不足しており、販売可能枠のシフトができません。すべての入荷待ち件数が差し押さえられています。",
          );
      }
    } catch (e) {
      if (!(e instanceof Error)) {
        console.error(e);
        throw e;
      }
      console.log("skuScheduleShift", sku.code, e.message);
      notifies.push({
        title: sku.code,
        ...(sku ? { title_link: cmsSKULink(sku.id) } : undefined),
        color: "danger",
        text: e.message,
        fields: [
          {
            title: "現在販売枠",
            value:
              sku.currentInventoryOrderSKU?.ShopifyInventoryOrders.name ??
              "実在庫",
          },
        ],
      });
    }
  }

  if (notifies.length)
    await postMessage(notifySlackChannel, "SKU調整処理通知", notifies);
};

const validateCMSData = async () => {
  const products = await getAllProducts();
  const alerts: MessageAttachment[] = [];
  for (const product of products) {
    if (!product.productGroupId)
      alerts.push({
        title: product.productName,
        title_link: cmsProductLink(product.id),
        text: "商品にグループが設定されていません",
        color: "danger",
      });
  }

  const variations = await getAllVariationSKUData();
  const skuCodeSet = new Set((await getAllSkus()).map(({ code }) => code));
  const notConnectedSKUVariations = variations.filter(
    ({ ShopifyVariants_ShopifyCustomSKUs }) =>
      ShopifyVariants_ShopifyCustomSKUs.length < 1,
  );
  for (const variations of notConnectedSKUVariations) {
    const { skusJSON, id, variantName } = variations;
    if (!skusJSON) {
      alerts.push({
        title: variantName,
        title_link: cmsVariationLink(id),
        text: "バリエーションにSKUが設定されていません",
        color: "danger",
      });
      continue;
    }
    let skus: string[] = [];
    try {
      skus = JSON.parse(skusJSON);
      if (skus.some((sku) => !skuCodeSet.has(sku)))
        alerts.push({
          title: variantName,
          title_link: cmsVariationLink(id),
          text: "設定したSKUコード(skusJSON)が間違っています。存在しないコードが設定されています。",
          color: "danger",
        });
    } catch (_) {
      alerts.push({
        title: variantName,
        title_link: cmsVariationLink(id),
        text: "skusJSONの形式が間違っています。",
        color: "danger",
      });
    }
  }

  const inventorySKUs = await getAllDuplicatedInventorySKUs();
  for (const inventorySKU of inventorySKUs) {
    alerts.push({
      title: `発注データの重複: ${inventorySKU.name}`,
      text: `発注ID: ${inventorySKU.id}の発注データの中で、同一SKUに対しての内訳が複数登録されているようです。`,
      color: "danger",
      fields: [
        {
          title: "SKUコード",
          value: [
            ...new Set(
              inventorySKU.ShopifyInventoryOrderSKUs.map(
                ({ sku }) => sku?.code,
              ),
            ),
          ].join(","),
        },
        {
          title: "発注内訳ID",
          value: [
            ...new Set(
              inventorySKU.ShopifyInventoryOrderSKUs.map(({ id }) => id),
            ),
          ].join(","),
        },
      ],
    });
  }

  if (alerts.length)
    for (const messageAttachments of sliceByNumber(alerts, 10)) {
      await postMessage(
        notifySlackChannel,
        "設定値に問題が発生しています。確認してください。",
        messageAttachments,
      );
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

const decode = <T extends string | null | undefined>(src: T): T => {
  if (typeof src !== "string") return src;
  try {
    return decodeURI(src) as T;
  } catch (_) {
    return src;
  }
};

const main = async () => {
  console.log("Validate CMS data");
  await validateCMSData();
  console.log("Sync products and variants");
  await Promise.all([products(), variants()]);
  console.log("Sync orders, lineItems and skus");
  await ordersAndLineItems();
  console.log("Shift sku schedule");
  await skuScheduleShift();
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
