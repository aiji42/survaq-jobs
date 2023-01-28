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
  title: string;
  strategy: FacebookAdsBudgetStrategy;
  intervalDays: number;
  adSetList: Array<{
    FacebookAdAlerts_id: string;
    FacebookAdSets_id: {
      accountId: string;
      accountName: string;
      setName: string;
      setId: string;
    };
  }>;
};

type RuleOperator = "<" | "<=" | "=" | ">=" | ">";
type RuleKey =
  | "roas_weekly"
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
  dayOfWeek: Array<"0" | "1" | "2" | "3" | "4" | "5" | "6">;
};

type Collections = {
  FacebookAdsBudget: FacebookAdsBudget;
  FacebookAdAlerts: FacebookAdAlerts;
};

const directus = new Directus<Collections>(DIRECTUS_URL, {
  auth: { mode: "cookie", staticToken: DIRECTUS_TOKEN },
});

export const getActiveFacebookAdsBudgets = async () => {
  const items = await directus.items("FacebookAdsBudget").readByQuery({
    filter: { active: true },
    fields: [
      "title",
      "active",
      "strategy",
      "intervalDays",
      "adSetList.FacebookAdSets_id.*",
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
      "dayOfWeek",
    ],
    limit: 100,
  });
  if (!items.data) return [];

  return items.data;
};
