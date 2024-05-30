import dayjs from "dayjs";
import {
  AdAccount,
  deleteByField,
  FBError,
  FBInsightError,
  FBInsightTimeoutError,
  getAdAccounts,
  getAdDailyInsights,
  getAdSetDailyInsights,
  insertRecords,
  InsightResponse,
  sliceByNumber,
} from "@survaq-jobs/libraries";
import { config } from "dotenv";

config();

const { FACEBOOK_BUSINESS_ACCOUNT_IDS = "", REPORT_DAY_RANGE = "0-6" } = process.env;

type BQRecordBase = {
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

const failedUrls: { id: string; error: string }[] = [];

export const adReports = async (): Promise<void> => {
  const [end, begin] = (REPORT_DAY_RANGE.split("-") as [string, string])
    .map(Number)
    .map((d) => dayjs().subtract(d, "day").format("YYYY-MM-DD")) as [string, string];
  const businessAccountIds = FACEBOOK_BUSINESS_ACCOUNT_IDS.split("|");
  const adAccounts = (await Promise.all(businessAccountIds.map((id) => getAdAccounts(id)))).flat();

  console.log("adAccounts: ", adAccounts.length);

  const adSetRecords = await makeAdSetReportRecords(adAccounts, begin, end);

  console.log("adSetRecords: ", adSetRecords.length);
  if (adSetRecords.length > 0) {
    for (const records of sliceByNumber(adSetRecords, 200)) {
      await deleteByField(
        "ads",
        "facebook",
        "id",
        records.map(({ id }) => id),
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
        records,
      );
    }
  }

  const adRecords = await makeAdReportRecords(adAccounts, begin, end);

  console.log("adRecords: ", adRecords.length);
  if (adRecords.length > 0) {
    for (const records of sliceByNumber(adRecords, 200)) {
      await deleteByField(
        "ad_atoms",
        "facebook",
        "id",
        records.map(({ id }) => id),
      );
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
      );
    }
  }
};

const makeRecordFromInsight = (data: InsightResponse["data"][0]): BQRecordBase => {
  const {
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
  } = data;
  return {
    impressions: Number(impressions ?? 0),
    spend: Number(spend ?? 0),
    reach: Number(reach ?? 0),
    clicks: Number(inline_link_clicks ?? 0),
    conversions: Number(
      actions?.find(({ action_type }) => action_type === "omni_purchase")?.value || 0,
    ),
    return: Number(
      action_values?.find(({ action_type }) => action_type === "omni_purchase")?.value || 0,
    ),
    date,
    datetime: `${date}T00:00:00`,
    ctr: Number(inline_link_click_ctr ?? 0),
    cpc: Number(cost_per_inline_link_click ?? 0),
    cpm: Number(cpm ?? 0),
    cpp: Number(cpp ?? 0),
    cpa: Number(
      cost_per_action_type?.find(({ action_type }) => action_type === "omni_purchase")?.value || 0,
    ),
  };
};

type AdSetReportRecord = {
  id: string;
  account_id: string;
  account_name: string;
  set_id: string;
  set_name: string;
} & BQRecordBase;

const makeAdSetReportRecords = async (
  addAccounts: AdAccount[],
  begin: string,
  end: string,
): Promise<AdSetReportRecord[]> => {
  const res = await Promise.all(
    addAccounts.map(async ({ id: adAccountId, name: adAccountName }) => {
      const res = await retryable(
        () => getAdSetDailyInsights(adAccountId, { begin, end }),
        `getAdSetDailyInsights(${adAccountId}, ${JSON.stringify({ begin, end })})`,
        1,
        30,
        [FBError, FBInsightError],
        (e) => {
          if (
            e instanceof FBError ||
            e instanceof FBInsightError ||
            e instanceof FBInsightTimeoutError
          ) {
            console.warn("Failed to get ad set insights", adAccountId, e);
            failedUrls.push({ id: `${adAccountId}-adSets`, error: e.message });
            return [];
          }
          throw e;
        },
      );
      return res.map<AdSetReportRecord>((data) => ({
        id: `${data.adset_id}_${data.date_start}`,
        account_id: adAccountId,
        account_name: adAccountName,
        set_id: data.adset_id,
        set_name: data.adset_name,
        ...makeRecordFromInsight(data),
      }));
    }),
  );

  return res.flat();
};

type AdReportRecord = {
  id: string;
  name: string;
  account_id: string;
  set_id: string;
  ad_id: string;
} & BQRecordBase;

const makeAdReportRecords = async (
  addAccounts: AdAccount[],
  begin: string,
  end: string,
): Promise<AdReportRecord[]> => {
  const res = await Promise.all(
    addAccounts.map(async ({ id: adAccountId }) => {
      const res = await retryable(
        () => getAdDailyInsights(adAccountId, { begin, end }),
        `getAdDailyInsights(${adAccountId}, ${JSON.stringify({ begin, end })})`,
        1,
        30,
        [FBError, FBInsightError],
        (e) => {
          if (
            e instanceof FBError ||
            e instanceof FBInsightError ||
            e instanceof FBInsightTimeoutError
          ) {
            console.warn("Failed to get ad insights", adAccountId, e);
            failedUrls.push({ id: `${adAccountId}-ads`, error: e.message });
            return [];
          }
          throw e;
        },
      );
      return res.map<AdReportRecord>((data) => ({
        id: `${data.ad_id}_${data.date_start}`,
        name: data.ad_name,
        account_id: adAccountId,
        set_id: data.adset_id,
        ad_id: data.adset_name,
        ...makeRecordFromInsight(data),
      }));
    }),
  );

  return res.flat();
};

const retryable = async <T>(
  callback: () => Promise<T>,
  label: string,
  retries: number,
  waitTime: number,
  retryableErrors: (new (...args: any[]) => Error)[],
  fallback: (err: any) => T,
): Promise<T> => {
  try {
    return await callback();
  } catch (error) {
    // エラーがリトライ対象かどうか確認
    const isRetryable = retryableErrors.some((errorType) => error instanceof errorType);
    if (isRetryable && retries > 0) {
      console.log("Retry:", label);
      // 指定された時間待つ
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
      // リトライ
      return retryable(callback, label, retries - 1, waitTime, retryableErrors, fallback);
    } else {
      // リトライしない場合はfallbackを実行
      return fallback(error);
    }
  }
};

const main = async () => {
  await adReports();
  // MEMO: failedUrlsが3件以上の場合はエラーを投げる(多少のエラーは許容する)
  if (failedUrls.length) console.log("Failed urls: ", failedUrls);
  if (failedUrls.length > 3) {
    console.error("Failed: ", failedUrls);
    throw new Error("Failed (but main process is success");
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
