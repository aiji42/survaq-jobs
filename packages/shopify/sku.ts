import { client, getAllSkus, BigQueryTimestamp } from "@survaq-jobs/libraries";

const { DIRECTUS_URL = "" } = process.env;

export const getPendingShipmentCounts = async (
  codes: string[],
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
  codeAndShippedAtSet: Array<{ code: string; shippedAt: string }>,
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
            `(fulfilled_at > '${shippedAt}' AND code = '${code}')`,
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
  sku: Awaited<ReturnType<typeof getAllSkus>>[number],
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

export const updatableInventoryOrdersAndNextInventoryOrder = (
  currentInventory: number,
  pendingShipmentCount: number,
  sku: Awaited<ReturnType<typeof getAllSkus>>[number],
) => {
  const buffer = sku.stockBuffer ?? 0;
  let rest = pendingShipmentCount;

  // 現在の出荷待ち件数を、実在庫 > 発注1 > 発注2 ... の順番に差押件数として振っていく
  const inventoryOrders = [
    // 計算上実在庫を仮想の発注データとして扱う
    { heldQuantity: 0, quantity: currentInventory, id: null },
    ...sku.inventoryOrderSKUs,
  ].map((order) => {
    const availableQuantity = order.quantity - buffer;
    const heldQuantity = Math.min(rest, availableQuantity);
    rest = Math.max(0, rest - heldQuantity);

    return {
      id: order.id,
      heldQuantity,
      modified: order.heldQuantity !== heldQuantity,
      available: availableQuantity > heldQuantity,
    };
  });

  const [last] = inventoryOrders.slice(-1);
  // availableが見つからないということは次にシフトすべき枠(発注データ)がないということ。とりあえず一番最後の発注を販売枠としておく
  // last!としているが、実在庫を仮想の発注として突っ込んでいるので、絶対にlastはundefinedにならない
  const nextInventoryOrder =
    inventoryOrders.find(({ available }) => available) ?? last!;

  const updatableInventoryOrders = inventoryOrders.filter(
    (
      order,
    ): order is {
      id: number;
      heldQuantity: number;
      modified: boolean;
      available: boolean;
    } => !!order.id && order.modified,
  );

  return { updatableInventoryOrders, nextInventoryOrder, rest };
};

export const nextAvailableStock = (
  availableStockPointer: string,
): "A" | "B" | "C" => {
  if (availableStockPointer === "REAL") return "A";
  if (availableStockPointer === "A") return "B";
  if (availableStockPointer === "B") return "C";
  throw new Error("A~Cまで枠をすべて使い切りました");
};

export const nextAvailableInventoryOrder = (
  sku: Awaited<ReturnType<typeof getAllSkus>>[number],
) => {
  const current = sku.currentInventoryOrderSKU;
  let next:
    | undefined
    | Awaited<
        ReturnType<typeof getAllSkus>
      >[number]["inventoryOrderSKUs"][number];
  if (!current) next = sku.inventoryOrderSKUs?.[0];
  else {
    const index = sku.inventoryOrderSKUs.findIndex(
      ({ id }) => id === sku.currentInventoryOrderSKUId,
    );
    next = sku.inventoryOrderSKUs?.[index + 1];
  }
  if (!next) throw new Error("次に販売枠をシフトすべき発注データがありません");
  return next;
};

export const validateStockQty = (
  availableStock: "A" | "B" | "C",
  sku: Awaited<ReturnType<typeof getAllSkus>>[number],
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
