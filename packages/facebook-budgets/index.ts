import {
  getRecords,
  insertRecords,
  sleep,
  getActiveFacebookAdsBudgets,
} from "@survaq-jobs/libraries";
import dayjs from "dayjs";

const { FACEBOOK_GRAPH_API_TOKEN = "" } = process.env;

const main = async () => {
  const today = dayjs();
  const referenceDate = today.add(-1, "day");

  const plans = await getActiveFacebookAdsBudgets();

  console.log("Find", plans.length, "plans");

  console.log("Reference date:", referenceDate.format("YYYY-MM-DD"));

  const processed = [];
  for (const plan of plans) {
    const [record] = await getRecords<{
      return_1week_sum: number;
      spend_1week_sum: number;
    }>("calc_for_roas", "facebook", ["return_1week_sum", "spend_1week_sum"], {
      date: referenceDate.format("YYYY-MM-DD"),
      set_id: plan.setId,
    });
    if (!record) {
      console.log(
        "Skip since the budget was not found on BigQuery:",
        plan.setId,
        plan.setName
      );
      return;
    }

    let res = await fetch(
      `https://graph.facebook.com/v14.0/${plan.setId}?fields=name,daily_budget&access_token=${FACEBOOK_GRAPH_API_TOKEN}`
    );
    if (!res.ok) {
      console.error(
        "Throw a error when requesting graph.facebook.com (getting ad set info)",
        plan.setId,
        plan.setName
      );
      throw new Error(await res.text());
    }
    const json: { name: string; daily_budget: string; id: string } =
      await res.json();

    const updated = await getRecords("budget_histories", "facebook", ["date"], {
      date: {
        value: today.add(-1 * plan.intervalDays, "days").format("YYYY-MM-DD"),
        operator: ">",
      },
      set_id: plan.setId,
    });
    if (updated.length > 0) {
      console.log(
        `Skip process since it has been less than ${plan.intervalDays} days since the last`,
        plan.setId,
        plan.setName
      );
      await sleep(0.5);
      continue;
    }

    const roas = record.return_1week_sum / record.spend_1week_sum;
    const { ratio } =
      plan.strategy.find(({ beginRoas, endRoas }) => {
        return (beginRoas ?? 0) <= roas && roas <= (endRoas ?? Infinity);
      }) ?? {};
    if (!ratio) {
      console.log(
        "Skip since the strategy was not found:",
        plan.setId,
        plan.setName
      );
      return;
    }

    const updatePlan = {
      account_id: plan.accountId,
      account_name: plan.accountName,
      set_id: plan.setId,
      set_name: plan.setName,
      date: today.format("YYYY-MM-DD"),
      before_budget: Number(json.daily_budget),
      after_budget: Math.floor(Number(json.daily_budget) * ratio),
      change_ratio: ratio,
      roas,
    };

    if (updatePlan.after_budget !== updatePlan.before_budget) {
      console.log("Request update budget", plan.setId, plan.setName);
      res = await fetch(
        `https://graph.facebook.com/v14.0/${plan.setId}?daily_budget=${updatePlan.after_budget}&access_token=${FACEBOOK_GRAPH_API_TOKEN}`,
        {
          method: "POST",
        }
      );
      if (!res.ok) {
        console.error(
          "Throw a error when requesting graph.facebook.com (updating budget)",
          plan.setId,
          plan.setName
        );
        throw new Error(await res.text());
      }
      console.log(
        "Updated budget",
        updatePlan.before_budget < updatePlan.after_budget ? "↗️" : "↘️",
        plan.setId,
        plan.setName
      );
    } else {
      console.log("Keep budget", plan.setId, plan.setName);
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
      [updatePlan]
    );

    processed.push(updatePlan);

    await sleep(0.5);
  }

  if (processed.length > 0) console.table(processed);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
