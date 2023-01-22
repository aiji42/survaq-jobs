import {
  FacebookAdAlertsRule,
  getActiveFacebookAdAlerts,
  getRecords,
} from "@survaq-jobs/libraries";
const { WebClient } = require("@slack/web-api");
import { config } from "dotenv";
config();

const { SLACK_API_TOKEN = "" } = process.env;

const slackClient = new WebClient(SLACK_API_TOKEN);

(async () => {
  const alerts = await getActiveFacebookAdAlerts();
  const setIds = alerts.flatMap(({ adSets }) =>
    adSets.map(({ FacebookAdSets_id: { setId } }) => setId)
  );

  const records = await getRecords<{
    set_id: string;
    return_1week_sum: number;
    spend_1week_sum: number;
    clicks_1week_sum: number;
    impressions_1week_sum: number;
  }>(
    "calc_for_roas",
    "facebook",
    [
      "set_id",
      "return_1week_sum",
      "spend_1week_sum",
      "clicks_1week_sum",
      "impressions_1week_sum",
    ],
    { date: "2023-01-22", set_id: setIds }
  );

  const data = Object.fromEntries(
    records.map(
      ({
        set_id,
        spend_1week_sum,
        return_1week_sum,
        clicks_1week_sum,
        impressions_1week_sum,
      }) => [
        set_id,
        {
          arpu: return_1week_sum / spend_1week_sum,
          cpc: spend_1week_sum / clicks_1week_sum,
          cpm: (spend_1week_sum / impressions_1week_sum) * 1000,
          ctr: clicks_1week_sum / impressions_1week_sum,
        },
      ]
    )
  );

  for (const alert of alerts) {
    for (const {
      FacebookAdSets_id: { setId },
    } of alert.adSets) {
      const matched = (alert.rule as FacebookAdAlertsRule).every(
        ({ key, value, operator }) => {
          let baseValue: number | undefined;
          if (key === "arpu_weekly") {
            baseValue = data[setId]?.arpu;
          } else if (key === "cpc_weekly") {
            baseValue = data[setId]?.cpc;
          }
          if (typeof baseValue === "undefined") {
            return false;
          }

          if (operator === ">") {
            return baseValue > value;
          }
          if (operator === ">=") {
            return baseValue >= value;
          }
          if (operator === "=") {
            return baseValue === value;
          }
          if (operator === "<=") {
            return baseValue <= value;
          }
          if (operator === "<") {
            return baseValue < value;
          }

          return false;
        }
      );

      if (matched) {
        await slackClient.chat.postMessage({
          channel: alert.channel,
          text: alert.message,
        });
      }
    }
  }
})();
