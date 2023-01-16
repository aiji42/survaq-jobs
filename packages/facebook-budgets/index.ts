import {
  getRecords,
  getLatestTimeAt,
  insertRecords,
  sleep,
  getActiveFacebookAdsBudgets,
} from "@survaq-jobs/libraries";
import dayjs from "dayjs";

const { FACEBOOK_GRAPH_API_TOKEN = "" } = process.env;

const main = async () => {
  const today = dayjs();
  const date = today.add(-1, "day");

  const lastProcessedOn = await getLatestTimeAt(
    "budget_histories",
    "facebook",
    "date"
  );
  if (today.diff(lastProcessedOn, "days") < 3) {
    console.log(
      "Skip process since  it has been less than 3 days since the last"
    );
    return;
  }

  const activeFacebookAdsBudgetRecords = await getActiveFacebookAdsBudgets();

  console.log("Find", activeFacebookAdsBudgetRecords.length, "records");

  console.log("Reference date:", date.format("YYYY-MM-DD"));

  const processed = [];
  for (const activeFacebookAdsBudgetRecord of activeFacebookAdsBudgetRecords) {
    const [record] = await getRecords<{
      account_id: string;
      account_name: string;
      set_id: string;
      set_name: string;
      return_1week_sum: number;
      spend_1week_sum: number;
    }>(
      "calc_for_roas",
      "facebook",
      [
        "account_id",
        "account_name",
        "set_id",
        "set_name",
        "return_1week_sum",
        "spend_1week_sum",
      ],
      {
        date: date.format("YYYY-MM-DD"),
        set_id: activeFacebookAdsBudgetRecord.setId,
      }
    );
    if (!record) {
      console.log(
        "Skip since the budget was not found on BigQuery:",
        activeFacebookAdsBudgetRecord.setId,
        activeFacebookAdsBudgetRecord.setName
      );
      return;
    }

    let res = await fetch(
      `https://graph.facebook.com/v14.0/${record.set_id}?fields=name,daily_budget&access_token=${FACEBOOK_GRAPH_API_TOKEN}`
    );
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const json: { name: string; daily_budget: string; id: string } =
      await res.json();

    const updated = await getRecords("budget_histories", "facebook", ["date"], {
      date: today.format("YYYY-MM-DD"),
      set_id: record.set_id,
    });
    if (updated.length > 0) {
      console.log(
        "Skip since the budget was already updated:",
        record.set_id,
        record.set_name
      );
      await sleep(0.5);
      continue;
    }

    const roas = record.return_1week_sum / record.spend_1week_sum;
    const { ratio } =
      activeFacebookAdsBudgetRecord.strategy.find(({ beginRoas, endRoas }) => {
        return (beginRoas ?? 0) <= roas && roas <= (endRoas ?? Infinity);
      }) ?? {};
    if (!ratio) {
      console.log(
        "Skip since the strategy was not found:",
        record.set_id,
        record.set_name
      );
      return;
    }

    const history = {
      account_id: record.account_id,
      account_name: record.account_name,
      set_id: record.set_id,
      set_name: record.set_name,
      date: today.format("YYYY-MM-DD"),
      before_budget: Number(json.daily_budget),
      after_budget: Math.floor(Number(json.daily_budget) * ratio),
      change_ratio: ratio,
      roas,
    };

    if (history.after_budget !== history.before_budget) {
      // res = await fetch(
      //   `https://graph.facebook.com/v14.0/${record.set_id}?daily_budget=${history.after_budget}&access_token=${FACEBOOK_GRAPH_API_TOKEN}`,
      //   {
      //     method: "POST",
      //   }
      // );
      if (!res.ok) {
        throw new Error(await res.text());
      }
      console.log(
        "Updated budget",
        history.before_budget < history.after_budget ? "↗️" : "↘️",
        record.set_id,
        record.set_name
      );
    } else {
      console.log("Keep budget", record.set_id, record.set_name);
    }

    await insertRecords(
      "budget_histories",
      "facebook",
      [
        "account_id",
        "account_name",
        "set_id",
        "set_name",
        "date",
        "before_budget",
        "after_budget",
        "change_ratio",
      ],
      [history]
    );

    processed.push(history);

    await sleep(0.5);
  }

  if (processed.length > 0) console.table(processed);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
