import { updateSku, postMessage, MessageAttachment, getAllSkus } from "@survaq-jobs/libraries";
import {
  cmsSKULink,
  getPendingShipmentCounts,
  getShippedCounts,
  updatableInventoryOrdersAndNextInventoryOrder,
} from "./sku";

const alertNotifySlackChannel = "#notify-cms";
const infoNotifySlackChannel = "#notify-cms-info";

const skuScheduleShift = async () => {
  const alertNotifies: MessageAttachment[] = [];
  const infoNotifies: MessageAttachment[] = [];
  const skusOnDB = await getAllSkus();
  const pendingShipmentCounts = await getPendingShipmentCounts(skusOnDB.map(({ code }) => code));
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

    try {
      const { updatableInventoryOrders, nextInventoryOrder, rest } =
        updatableInventoryOrdersAndNextInventoryOrder(inventory, unshippedOrderCount, sku);

      if (
        sku.inventory !== inventory ||
        sku.unshippedOrderCount !== unshippedOrderCount ||
        sku.lastSyncedAt !== lastSyncedAt ||
        sku.currentInventoryOrderSKUId !== nextInventoryOrder.id ||
        updatableInventoryOrders.length
      ) {
        console.log("update sku:", sku.code);

        if (sku.currentInventoryOrderSKUId !== nextInventoryOrder.id)
          infoNotifies.push({
            title: sku.code,
            title_link: cmsSKULink(sku.id),
            text: "下記SKUの販売枠を変更しました",
            color: "good",
            fields: [{ title: "新しい販売枠", value: nextInventoryOrder.title }],
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
      alertNotifies.push({
        title: sku.code,
        ...(sku ? { title_link: cmsSKULink(sku.id) } : undefined),
        color: "danger",
        text: e.message,
        fields: [
          {
            title: "現在販売枠",
            value: sku.currentInventoryOrderSKU?.ShopifyInventoryOrders.name ?? "実在庫",
          },
        ],
      });
    }
  }

  if (alertNotifies.length)
    await postMessage(alertNotifySlackChannel, "SKU調整処理通知", alertNotifies);
  if (infoNotifies.length)
    await postMessage(infoNotifySlackChannel, "SKU調整処理通知", infoNotifies);
};

const main = async () => {
  console.log("Shift sku schedule");
  await skuScheduleShift();
};
main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
