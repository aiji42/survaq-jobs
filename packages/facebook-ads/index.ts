import dayjs from "dayjs";
import { insertRecords, deleteByField } from "./bigquery-client";

type Paging = {
  cursors: {
    before: string;
    after: string;
  };
  next?: string;
  previous?: string;
};

type AdSetInsights = {
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
  data: { name: string; id: string; insights?: AdSetInsights }[];
  paging: Paging;
};

type AdAccount = {
  data: { name: string; id: string; adsets: AdSet }[];
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
  FACEBOOK_BUSINESS_ACCOUNT_ID = "",
  FACEBOOK_GRAPH_API_TOKEN = "",
  REPORT_DAY_RANGE = "0-7",
} = process.env;

export const adReports = async (): Promise<void> => {
  const days = (REPORT_DAY_RANGE.split("-") as [string, string]).map(
    Number
  ) as [number, number];
  const res = await Promise.all<AdReportRecord[]>(
    range(...days)
      .map((d) => dayjs().subtract(d, "day").format("YYYY-MM-DD"))
      .map((inspectDate) => getAdReportRecords(inspectDate))
  );

  const records = res.flat();
  console.log("records: ", records.length);
  if (records.length > 0) {
    await deleteByField(
      "ads",
      "facebook",
      "id",
      records.map(({ id }) => id)
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
      records
    );
  }
};

type AdReportRecord = {
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

const getAdReportRecords = async (
  inspectDate: string
): Promise<AdReportRecord[] | never> => {
  const records: AdReportRecord[] = [];
  let next = `https://graph.facebook.com/v13.0/${FACEBOOK_BUSINESS_ACCOUNT_ID}?fields=owned_ad_accounts.limit(5){name,adsets.limit(20){name,insights.time_range({since:'${inspectDate}',until:'${inspectDate}'}){impressions,spend,reach,inline_link_clicks,action_values,actions,inline_link_click_ctr,cost_per_inline_link_click,cpm,cpp,cost_per_action_type}}}&access_token=${FACEBOOK_GRAPH_API_TOKEN}`;
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
      adsets.data.forEach(({ id: setId, name: setName, insights }) => {
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
                  ({ action_type }) => action_type === "omni_purchase"
                )?.value || 0
              ),
              return: Number(
                action_values?.find(
                  ({ action_type }) => action_type === "omni_purchase"
                )?.value || 0
              ),
              date,
              datetime: `${date}T00:00:00`,
              ctr: Number(inline_link_click_ctr ?? 0),
              cpc: Number(cost_per_inline_link_click ?? 0),
              cpm: Number(cpm ?? 0),
              cpp: Number(cpp ?? 0),
              cpa: Number(
                cost_per_action_type?.find(
                  ({ action_type }) => action_type === "omni_purchase"
                )?.value || 0
              ),
            });
          }
        );
      });
    });
  }
  return records;
};

const range = (start: number, end: number) =>
  [...Array(end + 1).keys()].slice(start);

const main = async () => {
  await adReports();
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
