import { PrismaClient } from "@prisma/client";
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
  | "since_last_create";

export type FacebookAdAlertsRule = {
  key: RuleKey;
  value: number;
  operator: RuleOperator;
}[];

const { DRY_RUN } = process.env;

const prisma = new PrismaClient();

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

export const getShopifyProductGroups = async () => {
  return prisma.shopifyProductGroups.findMany({
    select: {
      id: true,
      title: true,
      ShopifyProducts: {
        select: {
          productId: true,
        },
      },
    },
  });
};

export const getGoogleMerchantCenter = async () => {
  return prisma.googleMerchantCenter.findMany({
    select: {
      merchantCenterId: true,
      shopifyProductGroup: true,
    },
  });
};

export const updateShopifyProductGroups = async (
  id: number,
  data: { realTotalPrice: number; realSupporters: number }
) => {
  if (DRY_RUN) {
    console.log("DRY RUN: update ShopifyProductGroups id:", id, data);
  } else {
    await prisma.shopifyProductGroups.update({
      data,
      where: { id },
    });
  }
};
