import { Directus } from "@directus/sdk";
import { config } from "dotenv";
config();

const { DIRECTUS_URL = "", DIRECTUS_TOKEN = "" } = process.env;

export type FacebookAdsBudgetStrategy = Array<{
  beginRoas: number | null;
  endRoas: number | null;
  ratio: number | null;
}>;

type FacebookAdsBudget = {
  active: boolean;
  accountId: string;
  accountName: string | null;
  setName: string | null;
  setId: string;
  strategy: FacebookAdsBudgetStrategy;
  intervalDays: number;
};

type RuleOperator = "<" | "<=" | "=" | ">=" | ">";
type RuleKey =
  | "arpu_weekly"
  | "cpc_weekly"
  | "cpm_weekly"
  | "ctr_weekly"
  | "since_last_create";

export type FacebookAdAlertsRule = {
  key: RuleKey;
  value: number;
  operator: RuleOperator;
}[];

type FacebookAdAlerts = {
  id: string;
  active: boolean;
  title: string;
  channel: string;
  message: string;
  rule: FacebookAdAlertsRule;
  adSets: Array<{
    FacebookAdAlerts_id: string;
    FacebookAdSets_id: {
      accountId: string;
      accountName: string;
      setName: string;
      setId: string;
    };
  }>;
};

type Collections = {
  FacebookAdsBudget: FacebookAdsBudget;
  FacebookAdAlerts: FacebookAdAlerts;
};

const directus = new Directus<Collections>(DIRECTUS_URL, {
  auth: { mode: "cookie", staticToken: DIRECTUS_TOKEN },
});

export const getActiveFacebookAdsBudgets = async (): Promise<
  FacebookAdsBudget[]
> => {
  const items = await directus.items("FacebookAdsBudget").readByQuery({
    filter: { active: true },
    fields: [
      "accountId",
      "accountName",
      "active",
      "setName",
      "setId",
      "strategy",
      "intervalDays",
    ],
    limit: 100,
  });
  if (!items.data) return [];

  return items.data;
};

export const getActiveFacebookAdAlerts = async () => {
  const items = await directus.items("FacebookAdAlerts").readByQuery({
    filter: { active: true },
    fields: [
      "id",
      "title",
      "active",
      "channel",
      "rule",
      "adSets.FacebookAdSets_id.*",
    ],
    limit: 100,
  });
  if (!items.data) return [];

  return items.data;
};
