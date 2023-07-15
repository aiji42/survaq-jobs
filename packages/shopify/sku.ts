import { client, getAllSkus, BigQueryTimestamp } from "@survaq-jobs/libraries";

const { DIRECTUS_URL = "" } = process.env;

export const getPendingShipmentCounts = async (
  codes: string[]
): Promise<Array<{ code: string; count: number }>> => {
  if (codes.length === 0) return [];
  const [res] = await client.query({
    query: `
      SELECT code, SUM(quantity) as count
      FROM shopify.order_skus
      WHERE canceled_at IS NULL
        AND closed_at IS NULL
        AND fulfilled_at IS NULL
        AND code IN (${codes.map((code) => `'${code}'`).join(",")})
      GROUP BY code;
    `,
  });
  return res;
};

export const getShippedCounts = async (
  codeAndShippedAtSet: Array<{ code: string; shippedAt: string }>
): Promise<
  Array<{ code: string; count: number; lastShippedAt: BigQueryTimestamp }>
> => {
  if (codeAndShippedAtSet.length === 0) return [];
  const [res] = await client.query({
    query: `
      SELECT code, SUM(quantity) as count, MAX(fulfilled_at) as lastShippedAt
      FROM shopify.order_skus
      WHERE ${codeAndShippedAtSet
        .map(
          ({ code, shippedAt }) =>
            `(fulfilled_at > '${shippedAt}' AND code = '${code}')`
        )
        .join(" OR ")}
      GROUP BY code
    `,
  });
  return res;
};

export const cmsSKULink = (id: number) =>
  `${DIRECTUS_URL}/admin/content/ShopifyCustomSKUs/${id}`;

export const getCurrentAvailableTotalStockCount = (
  inventory: number,
  sku: Awaited<ReturnType<typeof getAllSkus>>[number]
) => {
  let count = inventory;
  if (sku.availableStock === "REAL") return count;
  validateStockQty("A", sku);
  count += sku.incomingStockQtyA as number;
  if (sku.availableStock === "A") return count;
  validateStockQty("B", sku);
  count += sku.incomingStockQtyB as number;
  if (sku.availableStock === "B") return count;
  validateStockQty("C", sku);
  count += sku.incomingStockQtyC as number;
  return count;
};

export const nextAvailableStock = (
  availableStockPointer: string
): "A" | "B" | "C" => {
  if (availableStockPointer === "REAL") return "A";
  if (availableStockPointer === "A") return "B";
  if (availableStockPointer === "B") return "C";
  throw new Error("A~Cまで枠をすべて使い切りました");
};

export const validateStockQty = (
  availableStock: "A" | "B" | "C",
  sku: Awaited<ReturnType<typeof getAllSkus>>[number]
) => {
  if (
    availableStock === "A" &&
    (!sku.incomingStockQtyA ||
      !sku.incomingStockDateA ||
      !isScheduleFormat(sku.incomingStockDeliveryScheduleA))
  )
    throw new Error("A枠のデータが不足しているか不備があります");
  if (
    availableStock === "B" &&
    (!sku.incomingStockQtyB ||
      !sku.incomingStockDateB ||
      !isScheduleFormat(sku.incomingStockDeliveryScheduleB))
  )
    throw new Error("B枠のデータが不足しているか不備があります");
  if (
    availableStock === "C" &&
    (!sku.incomingStockQtyC ||
      !sku.incomingStockDateC ||
      !isScheduleFormat(sku.incomingStockDeliveryScheduleC))
  )
    throw new Error("C枠のデータが不足しているか不備があります");
};

const isScheduleFormat = (dateString: string | null): boolean => {
  const regex = /^(\d{4})-(0[1-9]|1[0-2])-(early|middle|late)$/;
  return regex.test(dateString ?? "");
};

export const incomingStock = (
  availableStock: "A" | "B" | "C",
  sku: Awaited<ReturnType<typeof getAllSkus>>[number]
): [Date, number] => {
  if (availableStock === "A") {
    validateStockQty("A", sku);
    return [sku.incomingStockDateA as Date, sku.incomingStockQtyA as number];
  }
  if (availableStock === "B") {
    validateStockQty("B", sku);
    return [sku.incomingStockDateB as Date, sku.incomingStockQtyB as number];
  }
  validateStockQty("C", sku);
  return [sku.incomingStockDateC as Date, sku.incomingStockQtyC as number];
};
