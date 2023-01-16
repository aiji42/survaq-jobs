import { Directus } from "@directus/sdk";
import { config } from "dotenv";
config();

const { DIRECTUS_URL = "", DIRECTUS_TOKEN = "" } = process.env;

type FacebookAdsBudgets = {
  accountId: string;
  accountName: string | null;
  active: boolean;
  setName: string | null;
  setId: string;
  strategy: Array<{
    beginRoas: number | null;
    endRoas: number | null;
    ratio: number | null;
  }>;
};

type Collections = {
  FacebookAdsBudgets: FacebookAdsBudgets;
};

const directus = new Directus<Collections>(DIRECTUS_URL, {
  auth: { mode: "cookie", staticToken: DIRECTUS_TOKEN },
});

export const getActiveFacebookAdsBudgets = async (): Promise<
  FacebookAdsBudgets[]
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
    ],
    limit: 100,
  });
  if (!items.data) return [];

  return items.data;
};
