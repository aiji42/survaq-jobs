import {
  getRecords,
  insertRecords,
  sleep,
  getActiveFacebookAdsBudgets,
  updateDailyBudget,
  fetchAdSetInfo,
  FacebookAdsBudgetStrategy,
} from "@survaq-jobs/libraries";
import dayjs from "dayjs";

const main = async () => {
  const today = dayjs();
  const referenceDate = today.add(-1, "day");

  const plans = await getActiveFacebookAdsBudgets();
  const flattenPlans = plans.flatMap(
    ({ FacebookAdsBudget_FacebookAdSets, ...plan }) =>
      FacebookAdsBudget_FacebookAdSets.flatMap(({ FacebookAdSets }) =>
        !FacebookAdSets
          ? []
          : {
              ...plan,
              accountId: FacebookAdSets.accountId,
              accountName: FacebookAdSets.accountName,
              setName: FacebookAdSets.setName,
              setId: FacebookAdSets.setId,
            }
      )
  );
  console.log(
    "Find",
    plans.length,
    "plans with",
    flattenPlans.length,
    "ad sets"
  );

  console.log("Reference date:", referenceDate.format("YYYY-MM-DD"));

  const processed = [];
  for (const plan of flattenPlans) {
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
      (plan.strategy as FacebookAdsBudgetStrategy).find(
        ({ beginRoas, endRoas }) => {
          return (beginRoas ?? 0) <= roas && roas <= (endRoas ?? Infinity);
        }
      ) ?? {};
    if (!ratio) {
      console.log(
        "Skip since the strategy was not found:",
        plan.setId,
        plan.setName
      );
      return;
    }

    const { daily_budget: currentBudget } = await fetchAdSetInfo(plan.setId);

    const updatePlan = {
      account_id: plan.accountId,
      account_name: plan.accountName,
      set_id: plan.setId,
      set_name: plan.setName,
      date: today.format("YYYY-MM-DD"),
      before_budget: Number(currentBudget),
      after_budget: Math.floor(Number(currentBudget) * ratio),
      change_ratio: ratio,
      roas,
    };

    if (updatePlan.after_budget !== updatePlan.before_budget) {
      console.log("Request update budget", plan.setId, plan.setName);
      await updateDailyBudget(plan.setId, updatePlan.after_budget);
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
main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
