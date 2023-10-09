import dayjs from "dayjs";
import {
  insertRecords,
  deleteByField,
  sliceByNumber,
  range,
  sleep,
} from "@survaq-jobs/libraries";
import { config } from "dotenv";
config();

type Paging = {
  cursors: {
    before: string;
    after: string;
  };
  next?: string;
  previous?: string;
};

type AdInsights = {
  data: {
    impressions: string;
    spend: string;
    reach: string;
    inline_link_clicks?: string;
    actions?: { action_type: string; value: string }[];
    action_values?: { action_type: string; value: string }[];
    date_start: string;
    date_stop: string;
    inline_link_click_ctr?: string;
    cost_per_inline_link_click?: string;
    cpm?: string;
    cpp?: string;
    cost_per_action_type?: { action_type: string; value: string }[];
  }[];
  paging: Paging;
};

type AdSet = {
  data: { name: string; id: string; insights?: AdInsights }[];
  paging: Paging;
};

type AdAccount = {
  data: { name: string; id: string; adsets?: AdSet }[];
  paging: Paging;
};

type Res = {
  owned_ad_accounts: AdAccount;
};

type FbError = {
  error: {
    message: string;
    type: string;
    code: string;
    error_subcode: string;
    fbtrace_id: string;
  };
};

const {
  FACEBOOK_BUSINESS_ACCOUNT_IDS = "",
  FACEBOOK_GRAPH_API_TOKEN = "",
  REPORT_DAY_RANGE = "0-6",
} = process.env;

export const adReports = async (): Promise<void> => {
  const days = (REPORT_DAY_RANGE.split("-") as [string, string]).map(
    Number,
  ) as [number, number];
  const inspectDates = range(...days).map((d) =>
    dayjs().subtract(d, "day").format("YYYY-MM-DD"),
  );
  let resAdSetReportRecord: AdSetReportRecord[][] = [];
  for (let businessAccountId of FACEBOOK_BUSINESS_ACCOUNT_IDS.split("|")) {
    resAdSetReportRecord = resAdSetReportRecord.concat(
      await Promise.all(
        inspectDates.map((inspectDate) =>
          getAdSetReportRecords(inspectDate, businessAccountId),
        ),
      ),
    );
  }

  const adSetRecords = resAdSetReportRecord.flat();
  console.log("adSetRecords: ", adSetRecords.length);
  if (adSetRecords.length > 0) {
    await deleteByField(
      "ads",
      "facebook",
      "id",
      adSetRecords.map(({ id }) => id),
    );
    await insertRecords(
      "ads",
      "facebook",
      [
        "id",
        "account_id",
        "account_name",
        "set_id",
        "set_name",
        "impressions",
        "spend",
        "reach",
        "clicks",
        "conversions",
        "return",
        "date",
        "datetime",
        "ctr",
        "cpc",
        "cpm",
        "cpp",
        "cpa",
      ],
      adSetRecords,
    );
  }
  const accountIds = [
    ...new Set(adSetRecords.map(({ account_id }) => account_id)),
  ];
  const resAdReportRecord = await Promise.all<AdReportRecord[]>(
    accountIds.flatMap((id) => {
      return inspectDates.map((date) => getAdReportRecords(date, id));
    }),
  );
  const adRecords = resAdReportRecord.flat();
  console.log("adRecords: ", adRecords.length);
  if (adRecords.length > 0) {
    let processedCount = 0;
    for (const records of sliceByNumber(adRecords, 100)) {
      processedCount += records.length;
      await deleteByField(
        "ad_atoms",
        "facebook",
        "id",
        records.map(({ id }) => id),
      );
      console.log("deleted:", `${processedCount}/${adRecords.length}`);
      await sleep(8);
      await insertRecords(
        "ad_atoms",
        "facebook",
        [
          "id",
          "name",
          "account_id",
          "set_id",
          "ad_id",
          "impressions",
          "spend",
          "reach",
          "clicks",
          "conversions",
          "return",
          "date",
          "datetime",
          "ctr",
          "cpc",
          "cpm",
          "cpp",
          "cpa",
        ],
        records,
        true,
      );
      console.log("inserted:", `${processedCount}/${adRecords.length}`);
    }
  }
};

type AdSetReportRecord = {
  id: string;
  account_id: string;
  account_name: string;
  set_id: string;
  set_name: string;
  impressions: number;
  spend: number;
  reach: number;
  clicks: number;
  conversions: number;
  return: number;
  date: string;
  datetime: string;
  ctr: number;
  cpc: number;
  cpm: number;
  cpp: number;
  cpa: number;
};

const getAdSetReportRecords = async (
  inspectDate: string,
  businessAccountId: string,
): Promise<AdSetReportRecord[] | never> => {
  const records: AdSetReportRecord[] = [];
  let next = `https://graph.facebook.com/v17.0/${businessAccountId}?fields=owned_ad_accounts.limit(5){name,adsets.limit(20){name,insights.time_range({since:'${inspectDate}',until:'${inspectDate}'}){impressions,spend,reach,inline_link_clicks,action_values,actions,inline_link_click_ctr,cost_per_inline_link_click,cpm,cpp,cost_per_action_type}}}&access_token=${FACEBOOK_GRAPH_API_TOKEN}`;
  while (next) {
    const res = await fetch(next).then((res) => {
      if (!res.ok) {
        const usage = res.headers.get("x-business-use-case-usage");
        usage && console.log(JSON.parse(usage));
      }
      return res.json() as Promise<Res | AdAccount | FbError>;
    });
    if ("error" in res) {
      console.error(res.error);
      throw new Error(res.error.message);
    }

    next =
      ("owned_ad_accounts" in res
        ? res.owned_ad_accounts.paging.next
        : res.paging.next) ?? "";
    const adAccount =
      "owned_ad_accounts" in res ? res.owned_ad_accounts.data : res.data;

    adAccount.forEach(({ id: accountId, name: accountName, adsets }) => {
      adsets?.data.forEach(({ id: setId, name: setName, insights }) => {
        insights?.data.forEach(
          ({
            impressions,
            spend,
            reach,
            inline_link_clicks,
            actions,
            action_values,
            date_start: date,
            inline_link_click_ctr,
            cost_per_inline_link_click,
            cpm,
            cpp,
            cost_per_action_type,
          }) => {
            records.push({
              id: `${setId}_${date}`,
              account_id: accountId,
              account_name: accountName,
              set_id: setId,
              set_name: setName,
              impressions: Number(impressions),
              spend: Number(spend),
              reach: Number(reach),
              clicks: Number(inline_link_clicks ?? 0),
              conversions: Number(
                actions?.find(
                  ({ action_type }) => action_type === "omni_purchase",
                )?.value || 0,
              ),
              return: Number(
                action_values?.find(
                  ({ action_type }) => action_type === "omni_purchase",
                )?.value || 0,
              ),
              date,
              datetime: `${date}T00:00:00`,
              ctr: Number(inline_link_click_ctr ?? 0),
              cpc: Number(cost_per_inline_link_click ?? 0),
              cpm: Number(cpm ?? 0),
              cpp: Number(cpp ?? 0),
              cpa: Number(
                cost_per_action_type?.find(
                  ({ action_type }) => action_type === "omni_purchase",
                )?.value || 0,
              ),
            });
          },
        );
      });
    });
  }
  return records;
};

type Ads = {
  data: {
    name: string;
    id: string;
    adset_id: string;
    account_id: string;
    insights?: AdInsights;
  }[];
  paging: Paging;
};

type AdReportRecord = {
  id: string;
  name: string;
  account_id: string;
  set_id: string;
  ad_id: string;
  impressions: number;
  spend: number;
  reach: number;
  clicks: number;
  conversions: number;
  return: number;
  date: string;
  datetime: string;
  ctr: number;
  cpc: number;
  cpm: number;
  cpp: number;
  cpa: number;
};

const getAdReportRecords = async (
  inspectDate: string,
  adAccountId: string,
): Promise<AdReportRecord[] | never> => {
  const records: AdReportRecord[] = [];
  let next = `https://graph.facebook.com/v17.0/${adAccountId}/ads?fields=id,name,adset_id,account_id,insights.time_range({since:'${inspectDate}',until:'${inspectDate}'}){impressions,spend,reach,inline_link_clicks,action_values,actions,inline_link_click_ctr,cost_per_inline_link_click,cpm,cpp,cost_per_action_type}&access_token=${FACEBOOK_GRAPH_API_TOKEN}`;
  while (next) {
    const res = await fetch(next).then((res) => {
      if (!res.ok) {
        const usage = res.headers.get("x-business-use-case-usage");
        usage && console.log(JSON.parse(usage));
      }
      return res.json() as Promise<Ads | FbError>;
    });
    if ("error" in res) {
      console.error(res.error);
      throw new Error(res.error.message);
    }

    next = res.paging.next ?? "";

    res.data.forEach(({ id, name, account_id, adset_id, insights }) => {
      insights?.data.forEach(
        ({
          impressions,
          spend,
          reach,
          inline_link_clicks,
          actions,
          action_values,
          date_start: date,
          inline_link_click_ctr,
          cost_per_inline_link_click,
          cpm,
          cpp,
          cost_per_action_type,
        }) => {
          records.push({
            id: `${id}_${date}`,
            name,
            account_id,
            set_id: adset_id,
            ad_id: id,
            impressions: Number(impressions),
            spend: Number(spend),
            reach: Number(reach),
            clicks: Number(inline_link_clicks ?? 0),
            conversions: Number(
              actions?.find(
                ({ action_type }) => action_type === "omni_purchase",
              )?.value || 0,
            ),
            return: Number(
              action_values?.find(
                ({ action_type }) => action_type === "omni_purchase",
              )?.value || 0,
            ),
            date,
            datetime: `${date}T00:00:00`,
            ctr: Number(inline_link_click_ctr ?? 0),
            cpc: Number(cost_per_inline_link_click ?? 0),
            cpm: Number(cpm ?? 0),
            cpp: Number(cpp ?? 0),
            cpa: Number(
              cost_per_action_type?.find(
                ({ action_type }) => action_type === "omni_purchase",
              )?.value || 0,
            ),
          });
        },
      );
    });
  }
  return records;
};

const main = async () => {
  await adReports();
};
main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
