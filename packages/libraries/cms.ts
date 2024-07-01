import { PrismaClient, Prisma } from "@prisma/client";
import { config } from "dotenv";
config();

export type FacebookAdsBudgetStrategy = Array<{
  beginRoas: number | null;
  endRoas: number | null;
  ratio: number | null;
}>;

type RuleOperator = "<" | "<=" | "=" | ">=" | ">";
type RuleKey =
  | "roas_weekly"
  | "roas_weekly_change_rate"
  | "roas_monthly_change_rate"
  | "cpc_weekly"
  | "cpm_weekly"
  | "ctr_weekly"
  | "cpc_weekly_change_rate"
  | "cpc_monthly_change_rate"
  | "since_last_create"
  | "budget";

export type FacebookAdAlertsRule = {
  key: RuleKey;
  value: number;
  operator: RuleOperator;
}[];

const { DRY_RUN } = process.env;

export const prisma = new PrismaClient();

export const getActiveFacebookAdsBudgets = async () => {
  return prisma.facebookAdsBudget.findMany({
    where: { active: true },
    select: {
      title: true,
      active: true,
      strategy: true,
      intervalDays: true,
      FacebookAdsBudget_FacebookAdSets: {
        select: {
          FacebookAdSets: {
            select: {
              accountId: true,
              accountName: true,
              setId: true,
              setName: true,
            },
          },
        },
      },
    },
  });
};

export const getActiveFacebookAdAlerts = async () => {
  return prisma.facebookAdAlerts.findMany({
    where: { active: true },
    select: {
      id: true,
      title: true,
      active: true,
      channel: true,
      rule: true,
      level: true,
      rule2: true,
      level2: true,
      rule3: true,
      level3: true,
      dayOfWeek: true,
      FacebookAdAlerts_FacebookAdSets: {
        select: {
          FacebookAdSets: {
            select: {
              accountId: true,
              accountName: true,
              setId: true,
              setName: true,
            },
          },
        },
      },
    },
  });
};

export const getAllSkus = async () => {
  return prisma.shopifyCustomSKUs.findMany({
    include: {
      inventoryOrderSKUs: {
        where: {
          ShopifyInventoryOrders: {
            status: { in: ["waitingShipping", "waitingReceiving"] },
          },
        },
        include: {
          ShopifyInventoryOrders: true,
        },
        orderBy: [
          {
            ShopifyInventoryOrders: {
              deliveryDate: "asc",
            },
          },
          {
            ShopifyInventoryOrders: {
              id: "asc",
            },
          },
        ],
      },
      currentInventoryOrderSKU: {
        include: {
          ShopifyInventoryOrders: true,
        },
      },
    },
    take: 1000,
  });
};

export const updateSku = async (
  code: string,
  data: Pick<
    Prisma.ShopifyCustomSKUsUpdateInput,
    | "lastSyncedAt"
    | "unshippedOrderCount"
    | "inventory"
    | "currentInventoryOrderSKU"
    | "inventoryOrderSKUs"
  >,
) => {
  if (DRY_RUN) {
    console.log("DRY RUN: update ShopifyCustomSKUs code:", code);
    console.dir(data, { depth: 5 });
  } else {
    await prisma.shopifyCustomSKUs.update({
      where: { code },
      data,
    });
  }
};
