import {
  FacebookAdAlertsRule,
  getActiveFacebookAdAlerts,
  getRecords,
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
} = process.env;

const slackClient = new WebClient(SLACK_API_TOKEN);

adsSdk.FacebookAdsApi.init(FACEBOOK_GRAPH_API_TOKEN);

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

(async () => {
  const alerts = await getActiveFacebookAdAlerts();
  const filteredAlert = alerts.filter(({ dayOfWeek }) => {
    return dayOfWeek.includes(String(dayjs().day()));
  });

  if (filteredAlert.length < 1) return;

  const setIds = filteredAlert.flatMap(({ adSets }) =>
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

  const daysSinceLastCreateSetId: Record<string, number> = {};
  for (const setId of setIds) {
    const adSetApiObj = new adsSdk.AdSet(setId);

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

  const dataBySetId = Object.fromEntries(
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
          roas: return_1week_sum / spend_1week_sum,
          cpc: spend_1week_sum / clicks_1week_sum,
          cpm: (spend_1week_sum / impressions_1week_sum) * 1000,
          ctr: clicks_1week_sum / impressions_1week_sum,
        },
      ]
    )
  );

  for (const alert of filteredAlert) {
    const slackAttachments: MessageAttachment[] = [];
    for (const { FacebookAdSets_id: adSet } of alert.adSets) {
      const data = dataBySetId[adSet.setId];
      if (!data) continue;

      const matched = (alert.rule as FacebookAdAlertsRule).every(
        ({ key, value, operator }) => {
          let baseValue: number | undefined;
          if (key === "roas_weekly") {
            baseValue = data.roas;
          } else if (key === "cpc_weekly") {
            baseValue = data.cpc;
          } else if (key === "cpm_weekly") {
            baseValue = data.cpm;
          } else if (key === "ctr_weekly") {
            baseValue = data.ctr;
          } else if (key === "since_last_create") {
            baseValue = daysSinceLastCreateSetId[adSet.setId];
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
        slackAttachments.push({
          title: adSet.setName,
          title_link: facebookAdSetLink(adSet),
          color: "warning",
          fields: (alert.rule as FacebookAdAlertsRule)
            .map(({ key }) => ({
              short: true,
              ...(key === "roas_weekly"
                ? {
                    title: "ROAS(週)",
                    value: dataBySetId[adSet.setId]!.roas.toFixed(2),
                  }
                : key === "cpc_weekly"
                ? {
                    title: "CPC(週)",
                    value: dataBySetId[adSet.setId]!.cpc.toFixed(2),
                  }
                : key === "cpm_weekly"
                ? {
                    title: "CPM(週)",
                    value: dataBySetId[adSet.setId]!.cpm.toFixed(2),
                  }
                : key === "ctr_weekly"
                ? {
                    title: "CTR(週)",
                    value: dataBySetId[adSet.setId]!.ctr.toFixed(2),
                  }
                : key === "since_last_create"
                ? {
                    title: "最終バナー作成日からの経過日数",
                    value: daysSinceLastCreateSetId[adSet.setId] ?? "",
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
      }
    }
    if (slackAttachments.length > 0) {
      await slackClient.chat.postMessage({
        channel: alert.channel,
        text: `*🔔 <${cmsFacebookAdAlertsContentLink(alert)}|${
          alert.title
        }>*\n`,
        attachments: slackAttachments,
      });
    }
  }
})();
