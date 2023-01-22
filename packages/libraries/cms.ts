import { Directus } from "@directus/sdk";
import { config } from "dotenv";
config();

const { DIRECTUS_URL = "", DIRECTUS_TOKEN = "" } = process.env;

type FacebookAdsBudget = {
  active: boolean;
  accountId: string;
  accountName: string | null;
  setName: string | null;
  setId: string;
  strategy: Array<{
    beginRoas: number | null;
    endRoas: number | null;
    ratio: number | null;
  }>;
  intervalDays: number;
};

type RuleOperator = "<" | "<=" | "=" | ">=" | ">";
type RuleKey = "arpu_weekly" | "cpc_weekly";

type FacebookAdAlerts = {
  active: boolean;
  title: string;
  channel: string;
  message: string;
  rule: Array<{ key: RuleKey; value: number; operator: RuleOperator }>;
  adSets: Array<{
    FacebookAdAlerts_id: string;
    FacebookAdSets_id: {
      accountId: string;
      accountName: string | null;
      setName: string | null;
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

export const getActiveFacebookAdsBudgets = async () => {
  const items = await directus.items("FacebookAdsBudget").readByQuery({
    filter: { active: true },
    fields: [
      "accountId",
      "accountName",
      "active",
      "setName",
      "setId",
      "strategy.*",
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
      "title",
      "active",
      "channel",
      "message",
      "rule.*",
      "adSets.FacebookAdSets_id.*",
    ],
    limit: 100,
  });
  if (!items.data) return [];

  return items.data;
};
