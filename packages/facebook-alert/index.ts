import {
  FacebookAdAlertsRule,
  fetchAdSetInfo,
  getActiveFacebookAdAlerts,
  getRecords,
  sleep,
} from "@survaq-jobs/libraries";
const { WebClient } = require("@slack/web-api");
import { config } from "dotenv";
import { MessageAttachment } from "@slack/web-api";
import * as adsSdk from "facebook-nodejs-business-sdk";
import dayjs from "dayjs";
config();

const {
  SLACK_API_TOKEN = "",
  DIRECTUS_URL = "",
  FACEBOOK_GRAPH_API_TOKEN = "",
  DRY_RUN,
} = process.env;

const slackClient = new WebClient(SLACK_API_TOKEN);

adsSdk.FacebookAdsApi.init(FACEBOOK_GRAPH_API_TOKEN);

type BQRecord = {
  set_id: string;
  return_1week_sum: number;
  spend_1week_sum: number;
  clicks_1week_sum: number;
  impressions_1week_sum: number;
};

const facebookAdSetLink = ({
  accountId,
  setId,
}: {
  accountId: string;
  setId: string;
}) =>
  `https://business.facebook.com/adsmanager/manage/ads?act=${accountId.replace(
    "act_",
    ""
  )}&selected_adset_ids=${setId}`;

const cmsFacebookAdAlertsContentLink = ({ id }: { id: string }) =>
  `${DIRECTUS_URL}/admin/content/FacebookAdAlerts/${id}`;

const main = async () => {
  const alerts = await getActiveFacebookAdAlerts();
  console.log(alerts.length, "alerts");
  const filteredAlerts = alerts.filter(({ dayOfWeek }) => {
    return (dayOfWeek as string[]).includes(String(dayjs().day()));
  });

  if (filteredAlerts.length < 1) return;

  console.log(filteredAlerts.length, "target alerts");
  const setIds = [
    ...new Set(
      filteredAlerts.flatMap(({ FacebookAdAlerts_FacebookAdSets }) =>
        FacebookAdAlerts_FacebookAdSets.flatMap(({ FacebookAdSets }) =>
          !FacebookAdSets ? [] : FacebookAdSets.setId
        )
      )
    ),
  ];

  const columns = [
    "set_id",
    "return_1week_sum",
    "spend_1week_sum",
    "clicks_1week_sum",
    "impressions_1week_sum",
  ];

  const currentWeekRecords = await getRecords<BQRecord>(
    "calc_for_roas",
    "facebook",
    columns,
    {
      date: dayjs().add(-1, "day").format("YYYY-MM-DD"),
      set_id: setIds,
    }
  );
  const lastWeekRecords = await getRecords<BQRecord>(
    "calc_for_roas",
    "facebook",

    columns,
    { date: dayjs().add(-7, "day").format("YYYY-MM-DD"), set_id: setIds }
  );
  const lastMonthRecords = await getRecords<BQRecord>(
    "calc_for_roas",
    "facebook",

    columns,
    { date: dayjs().add(-31, "day").format("YYYY-MM-DD"), set_id: setIds }
  );

  const daysSinceLastCreateSetId: Record<string, number> = {};
  for (const setId of setIds) {
    const adSetApiObj = new adsSdk.AdSet(setId);

    console.log("fetch ads: ", setId);
    const ads = await adSetApiObj.getAds(["created_time", "status"]);

    const lastCreatedAt = ads.reduce<null | string>((res, ad) => {
      if (ad["status"] !== "ACTIVE") return res;
      if (!res) return ad["created_time"];
      return res > ad["created_time"] ? res : ad["created_time"];
    }, null);
    if (!lastCreatedAt) continue;
    daysSinceLastCreateSetId[setId] = Math.abs(
      dayjs(lastCreatedAt).diff(dayjs(), "day")
    );
  }

  const dailyBudgetSetId: Record<string, number> = {};
  for (const setId of setIds) {
    console.log("fetch budget: ", setId);
    const { daily_budget } = await fetchAdSetInfo(setId);
    dailyBudgetSetId[setId] = Number(daily_budget);
  }

  const dataBySetId = Object.fromEntries(
    currentWeekRecords.map(
      ({
        set_id,
        spend_1week_sum,
        return_1week_sum,
        clicks_1week_sum,
        impressions_1week_sum,
      }) => {
        const roas = return_1week_sum / spend_1week_sum;
        const cpc = spend_1week_sum / clicks_1week_sum;
        const lastWeek = lastWeekRecords.find(
          (lastWeek) => set_id === lastWeek.set_id
        );
        const cpcLastWeek = lastWeek
          ? lastWeek.spend_1week_sum / lastWeek.clicks_1week_sum
          : null;
        const roasLastWeek = lastWeek
          ? lastWeek.return_1week_sum / lastWeek.spend_1week_sum
          : null;
        const lastMonth = lastMonthRecords.find(
          (lastWeek) => set_id === lastWeek.set_id
        );
        const cpcLastMonth = lastMonth
          ? lastMonth.spend_1week_sum / lastMonth.clicks_1week_sum
          : null;
        const roasLastMonth = lastMonth
          ? lastMonth.return_1week_sum / lastMonth.spend_1week_sum
          : null;
        return [
          set_id,
          {
            roas,
            roasLastWeek,
            roasChangeRateWeekly: roasLastWeek ? roas / roasLastWeek : 0,
            roasLastMonth,
            roasChangeRateMonthly: roasLastMonth ? roas / roasLastMonth : 0,
            cpc,
            cpcLastWeek,
            cpcChangeRateWeekly: cpcLastWeek ? cpc / cpcLastWeek : Infinity,
            cpcLastMonth,
            cpcChangeRateMonthly: cpcLastMonth ? cpc / cpcLastMonth : Infinity,
            cpm: (spend_1week_sum / impressions_1week_sum) * 1000,
            ctr: clicks_1week_sum / impressions_1week_sum,
          },
        ];
      }
    )
  );

  for (const alert of filteredAlerts) {
    const slackAttachments: MessageAttachment[] = [];
    for (const {
      FacebookAdSets: adSet,
    } of alert.FacebookAdAlerts_FacebookAdSets) {
      if (!adSet) continue;
      const data = dataBySetId[adSet.setId];
      if (!data) continue;

      const ruleSets = [
        {
          rule: alert.rule,
          level: alert.level,
        },
        {
          rule: alert.rule2,
          level: alert.level2,
        },
        {
          rule: alert.rule3,
          level: alert.level3,
        },
      ];

      for (const ruleSet of ruleSets) {
        if ((ruleSet.rule as FacebookAdAlertsRule).length < 1) continue;
        const matched = (ruleSet.rule as FacebookAdAlertsRule).every(
          ({ key, value, operator }) => {
            let baseValue: number | undefined;
            if (key === "roas_weekly") {
              baseValue = data.roas;
            } else if (key === "roas_weekly_change_rate") {
              baseValue = data.roasChangeRateWeekly;
            } else if (key === "roas_monthly_change_rate") {
              baseValue = data.roasChangeRateMonthly;
            } else if (key === "cpc_weekly") {
              baseValue = data.cpc;
            } else if (key === "cpc_weekly_change_rate") {
              baseValue = data.cpcChangeRateWeekly;
            } else if (key === "cpc_monthly_change_rate") {
              baseValue = data.cpcChangeRateMonthly;
            } else if (key === "cpm_weekly") {
              baseValue = data.cpm;
            } else if (key === "ctr_weekly") {
              baseValue = data.ctr;
            } else if (key === "since_last_create") {
              baseValue = daysSinceLastCreateSetId[adSet.setId];
            } else if (key === "budget") {
              baseValue = dailyBudgetSetId[adSet.setId];
            }
            if (typeof baseValue === "undefined") {
              return false;
            }

            if (operator === ">") {
              return baseValue > value;
            } else if (operator === ">=") {
              return baseValue >= value;
            } else if (operator === "=") {
              return baseValue === value;
            } else if (operator === "<=") {
              return baseValue <= value;
            } else if (operator === "<") {
              return baseValue < value;
            }

            return false;
          }
        );
        if (matched) {
          const adSetData = dataBySetId[adSet.setId]!;
          slackAttachments.push({
            title: adSet.setName,
            title_link: facebookAdSetLink(adSet),
            color: ruleSet.level,
            fields: (ruleSet.rule as FacebookAdAlertsRule)
              .map(({ key }) => ({
                short: true,
                ...(key === "roas_weekly"
                  ? {
                      title: "ROAS(週)",
                      value: adSetData.roas.toFixed(2),
                    }
                  : key === "roas_weekly_change_rate"
                  ? {
                      title: "ROAS変動比(先週比)",
                      value: `${adSetData.roasChangeRateWeekly.toFixed(
                        2
                      )} (${adSetData.roas.toFixed(2)} / ${
                        adSetData.roasLastWeek?.toFixed(2) ?? "-"
                      })`,
                    }
                  : key === "roas_monthly_change_rate"
                  ? {
                      title: "ROAS変動比(先月比)",
                      value: `${adSetData.roasChangeRateMonthly.toFixed(
                        2
                      )} (${adSetData.roas.toFixed(2)} / ${
                        adSetData.roasLastMonth?.toFixed(2) ?? "-"
                      })`,
                    }
                  : key === "cpc_weekly"
                  ? {
                      title: "CPC(週)",
                      value: adSetData.cpc.toFixed(2),
                    }
                  : key === "cpc_weekly_change_rate"
                  ? {
                      title: "CPC変動比(先週比)",
                      value: `${adSetData.cpcChangeRateWeekly.toFixed(
                        2
                      )} (${adSetData.cpc.toFixed(2)} / ${
                        adSetData.cpcLastWeek?.toFixed(2) ?? "-"
                      })`,
                    }
                  : key === "cpc_monthly_change_rate"
                  ? {
                      title: "CPC変動比(先月比)",
                      value: `${adSetData.cpcChangeRateMonthly.toFixed(
                        2
                      )} (${adSetData.cpc.toFixed(2)} / ${
                        adSetData.cpcLastMonth?.toFixed(2) ?? "-"
                      })`,
                    }
                  : key === "cpm_weekly"
                  ? {
                      title: "CPM(週)",
                      value: adSetData.cpm.toFixed(2),
                    }
                  : key === "ctr_weekly"
                  ? {
                      title: "CTR(週)",
                      value: adSetData.ctr.toFixed(2),
                    }
                  : key === "since_last_create"
                  ? {
                      title: "最終バナー作成日からの経過日数",
                      value: daysSinceLastCreateSetId[adSet.setId] ?? "",
                    }
                  : key === "budget"
                  ? {
                      title: "広告デイリー予算",
                      value: dailyBudgetSetId[adSet.setId] ?? "",
                    }
                  : undefined),
              }))
              .filter(
                (
                  field
                ): field is {
                  title: string;
                  value: string;
                  short: boolean;
                } => !!field.title && !!field.value
              ),
          });

          break;
        }
      }
    }
    if (slackAttachments.length > 0) {
      const message = {
        channel: alert.channel,
        text: `*🔔 <${cmsFacebookAdAlertsContentLink(alert)}|${
          alert.title
        }>*\n`,
        attachments: slackAttachments,
      };
      if (DRY_RUN) {
        console.log("DRY_RUN: post message", message);
      } else {
        console.log("post message", message);
        await slackClient.chat.postMessage(message);
        await sleep(5);
      }
    }
  }
};
main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
