import { config } from "dotenv";
config();

const { FACEBOOK_GRAPH_API_TOKEN = "", DRY_RUN } = process.env;

export const updateDailyBudget = async (setId: string, newBudget: number) => {
  if (DRY_RUN) {
    console.log("DRY RUN: update facebook daily budget", setId);
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/v14.0/${setId}?daily_budget=${newBudget}&access_token=${FACEBOOK_GRAPH_API_TOKEN}`,
    {
      method: "POST",
    }
  );
  if (!res.ok) {
    console.error("Failed updating budget", setId);
    throw new Error(await res.text());
  }
};

export const fetchAdSetInfo = async (
  setId: string
): Promise<{ name: string; daily_budget: string; id: string }> => {
  const res = await fetch(
    `https://graph.facebook.com/v14.0/${setId}?fields=name,daily_budget&access_token=${FACEBOOK_GRAPH_API_TOKEN}`
  );
  if (!res.ok) {
    console.error("Failed fetch ad set info", setId);
    throw new Error(await res.text());
  }

  return res.json();
};
