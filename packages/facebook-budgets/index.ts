import {
  getRecords,
  insertRecords,
  sleep,
  sliceByNumber,
} from "@survaq-jobs/libraries";
import dayjs from "dayjs";

const { FACEBOOK_GRAPH_API_TOKEN = "" } = process.env;

const main = async () => {
  const today = dayjs();
  const date = today.add(-1, "day");
  console.log("Reference date:", date.format("YYYY-MM-DD"));

  const records = await getRecords<{
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
    { date: date.format("YYYY-MM-DD") }
  );
  console.log("Find", records.length, "records");

  const histories: {
    account_id: string;
    account_name: string;
    set_id: string;
    set_name: string;
    date: string;
    before_budget: number;
    after_budget: number;
    change_ratio: number;
    roas: number;
  }[] = [];
  for (const record of records) {
    const res = await fetch(
      `https://graph.facebook.com/v14.0/${record.set_id}?fields=name,daily_budget&access_token=${FACEBOOK_GRAPH_API_TOKEN}`
    );
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const json: { name: string; daily_budget: string; id: string } =
      await res.json();

    const roas = record.return_1week_sum / record.spend_1week_sum;
    const ratio = roas < 2 ? 0.8 : roas > 3 ? 1.2 : 1.0;

    histories.push({
      account_id: record.account_id,
      account_name: record.account_name,
      set_id: record.set_id,
      set_name: record.set_name,
      date: today.format("YYYY-MM-DD"),
      before_budget: Number(json.daily_budget),
      after_budget: Math.floor(Number(json.daily_budget) * ratio),
      change_ratio: ratio,
      roas,
    });

    await sleep(0.5);
  }

  for (const newRecords of sliceByNumber(histories, 200)) {
    console.table(newRecords);
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
      newRecords
    );
  }
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
