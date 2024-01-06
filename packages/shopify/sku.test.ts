import { SKU, updatableInventoryOrdersAndNextInventoryOrder } from "./sku";

describe("sku", () => {
  describe("updatableInventoryOrdersAndNextInventoryOrder", () => {
    const inventoryOrderSKUs = [
      {
        id: 1,
        quantity: 100,
        heldQuantity: 0,
        ShopifyInventoryOrders: { name: "ShopifyInventoryOrders_1" },
      },
      {
        id: 2,
        quantity: 100,
        heldQuantity: 0,
        ShopifyInventoryOrders: { name: "ShopifyInventoryOrders_2" },
      },
    ] as SKU["inventoryOrderSKUs"];

    test("未出荷件数が実在庫を下回るケース", () => {
      expect(
        updatableInventoryOrdersAndNextInventoryOrder(100, 10, {
          stockBuffer: 5,
          faultyRate: 0,
          inventoryOrderSKUs,
        } as SKU),
      ).toEqual({
        nextInventoryOrder: {
          available: true,
          heldQuantity: 10,
          id: null,
          modified: true,
          title: "REAL",
        },
        rest: 0,
        updatableInventoryOrders: [],
      });
    });

    test("未出荷件数が実在庫を上回るケース", () => {
      // 不良率0%
      expect(
        updatableInventoryOrdersAndNextInventoryOrder(100, 150, {
          stockBuffer: 5,
          faultyRate: 0,
          inventoryOrderSKUs,
        } as SKU),
      ).toEqual({
        nextInventoryOrder: {
          available: true,
          heldQuantity: 55,
          id: 1,
          modified: true,
          title: "ShopifyInventoryOrders_1",
        },
        rest: 0,
        updatableInventoryOrders: [
          {
            available: true,
            heldQuantity: 55,
            id: 1,
            modified: true,
            title: "ShopifyInventoryOrders_1",
          },
        ],
      });

      // 不良率とバッファのうち大きい方が適応される(この場合、stockBuffer: 5)
      expect(
        updatableInventoryOrdersAndNextInventoryOrder(100, 150, {
          stockBuffer: 5,
          faultyRate: 0.04,
          inventoryOrderSKUs,
        } as SKU),
      ).toEqual({
        nextInventoryOrder: {
          available: true,
          heldQuantity: 55,
          id: 1,
          modified: true,
          title: "ShopifyInventoryOrders_1",
        },
        rest: 0,
        updatableInventoryOrders: [
          {
            available: true,
            heldQuantity: 55,
            id: 1,
            modified: true,
            title: "ShopifyInventoryOrders_1",
          },
        ],
      });

      // 不良率とバッファのうち大きい方が適応される(この場合、faultyRate: 0.06)
      expect(
        updatableInventoryOrdersAndNextInventoryOrder(100, 150, {
          stockBuffer: 5,
          faultyRate: 0.06,
          inventoryOrderSKUs,
        } as SKU),
      ).toEqual({
        nextInventoryOrder: {
          available: true,
          heldQuantity: 56,
          id: 1,
          modified: true,
          title: "ShopifyInventoryOrders_1",
        },
        rest: 0,
        updatableInventoryOrders: [
          {
            available: true,
            heldQuantity: 56,
            id: 1,
            modified: true,
            title: "ShopifyInventoryOrders_1",
          },
        ],
      });

      // stockBufferは実在庫にのみ適応される(実在庫: 95, 発注枠1: 96, 発注枠2: 59)
      expect(
        updatableInventoryOrdersAndNextInventoryOrder(100, 250, {
          stockBuffer: 5,
          faultyRate: 0.04,
          inventoryOrderSKUs,
        } as SKU),
      ).toEqual({
        nextInventoryOrder: {
          available: true,
          heldQuantity: 59,
          id: 2,
          modified: true,
          title: "ShopifyInventoryOrders_2",
        },
        rest: 0,
        updatableInventoryOrders: [
          {
            available: false,
            heldQuantity: 96,
            id: 1,
            modified: true,
            title: "ShopifyInventoryOrders_1",
          },
          {
            available: true,
            heldQuantity: 59,
            id: 2,
            modified: true,
            title: "ShopifyInventoryOrders_2",
          },
        ],
      });
    });

    test("実在庫がマイナスのケース", () => {
      expect(
        updatableInventoryOrdersAndNextInventoryOrder(-10, 50, {
          stockBuffer: 5,
          faultyRate: 0.1,
          inventoryOrderSKUs,
        } as SKU),
      ).toEqual({
        nextInventoryOrder: {
          available: true,
          heldQuantity: 65,
          id: 1,
          modified: true,
          title: "ShopifyInventoryOrders_1",
        },
        rest: 0,
        updatableInventoryOrders: [
          {
            available: true,
            heldQuantity: 65,
            id: 1,
            modified: true,
            title: "ShopifyInventoryOrders_1",
          },
        ],
      });

      // faultyRateは実在庫がマイナスのときは適応されない
      expect(
        updatableInventoryOrdersAndNextInventoryOrder(-10, 50, {
          stockBuffer: 0,
          faultyRate: 0.1,
          inventoryOrderSKUs,
        } as SKU),
      ).toEqual({
        nextInventoryOrder: {
          available: true,
          heldQuantity: 60,
          id: 1,
          modified: true,
          title: "ShopifyInventoryOrders_1",
        },
        rest: 0,
        updatableInventoryOrders: [
          {
            available: true,
            heldQuantity: 60,
            id: 1,
            modified: true,
            title: "ShopifyInventoryOrders_1",
          },
        ],
      });
    });

    test("未出荷が発注枠に収まりきらないケース", () => {
      expect(
        updatableInventoryOrdersAndNextInventoryOrder(80, 400, {
          stockBuffer: 5,
          faultyRate: 0.1,
          inventoryOrderSKUs,
        } as SKU),
      ).toEqual({
        nextInventoryOrder: {
          available: false,
          heldQuantity: 90,
          id: 2,
          modified: true,
          title: "ShopifyInventoryOrders_2",
        },
        rest: 148,
        updatableInventoryOrders: [
          {
            available: false,
            heldQuantity: 90,
            id: 1,
            modified: true,
            title: "ShopifyInventoryOrders_1",
          },
          {
            available: false,
            heldQuantity: 90,
            id: 2,
            modified: true,
            title: "ShopifyInventoryOrders_2",
          },
        ],
      });
    });
  });
});
