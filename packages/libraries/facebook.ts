import { config } from "dotenv";
import { sleep } from "./utils";
config();

const { FACEBOOK_GRAPH_API_TOKEN = "", DRY_RUN } = process.env;

const GRAPH_API_VERSION = "v19.0";

type FBErrorResponse = {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode: number;
    fbtrace_id: string;
  };
};

export class FBError extends Error {
  code: number;
  subcode: number;
  constructor(public error: FBErrorResponse["error"]) {
    super(error.message);
    this.code = error.code;
    this.subcode = error.error_subcode;
  }

  get isTooManyRequests() {
    return this.code === 17 && this.subcode === 2446079;
  }
}

export class FBInsightError extends Error {
  url: URL;
  constructor(message: string, url: string | URL) {
    super(message);
    this.url = new URL(url.toString());
  }
}

export class FBInsightTimeoutError extends Error {
  url: URL;
  constructor(message: string, url: string | URL) {
    super(message);
    this.url = new URL(url.toString());
  }
}

type FBPaging = {
  cursors: {
    before: string;
    after: string;
  };
  next?: string;
  previous?: string;
};

type FBSuccessResponse<T> = {
  data: T[];
  paging?: FBPaging;
};

const makeGraphApiUrl = (
  path: string,
  params?: {
    fields?: string[];
    timeRange?: { since: string; until: string };
    level?: "ad" | "adset";
    timeIncrement?: number;
    dailyBudget?: number;
  },
) => {
  const url = new URL(`https://graph.facebook.com`);
  url.pathname = `/${GRAPH_API_VERSION}/${path}`.replace(/\/+/g, "/");
  if (params?.fields) url.searchParams.append("fields", params.fields.join(","));
  if (params?.timeRange)
    url.searchParams.append(
      "time_range",
      `{since:'${params.timeRange.since}',until:'${params.timeRange.until}'}`,
    );
  if (params?.level) url.searchParams.append("level", params.level);
  if (typeof params?.timeIncrement === "number")
    url.searchParams.append("time_increment", String(params.timeIncrement));
  if (typeof params?.dailyBudget === "number")
    url.searchParams.append("daily_budget", String(params.dailyBudget));

  url.searchParams.append("access_token", FACEBOOK_GRAPH_API_TOKEN);

  return url;
};

const fetchGraphApiJson = async (url: string | URL, init?: RequestInit) => {
  const maskedUrl = new URL(url.toString());
  maskedUrl.searchParams.delete("access_token");
  console.log(init?.method ?? "GET", maskedUrl.toString());

  const res = await fetch(url, init);
  if (!res.ok) {
    const usage = res.headers.get("x-business-use-case-usage");
    usage && console.log(JSON.parse(usage));
    const json: FBErrorResponse = await res.json();
    console.error("error", init?.method ?? "GET", url.toString());
    console.error(json.error);

    throw new FBError(json.error);
  }

  return res.json();
};

const recursiveFetch = async <T>(a: FBSuccessResponse<T>): Promise<T[]> => {
  const data = a.data;
  let next = a.paging?.next;
  while (next) {
    const res = await fetchGraphApiJson(next);
    data.push(...res.data);
    next = res.paging?.next;
  }

  return data;
};

export const updateDailyBudget = async (setId: string, newBudget: number) => {
  if (DRY_RUN) {
    console.log("DRY RUN: update facebook daily budget", setId);
    return;
  }

  await fetchGraphApiJson(makeGraphApiUrl(`/${setId}`, { dailyBudget: newBudget }), {
    method: "POST",
  });
};

export const getAdSetNameAndDailyBudget = async (
  setId: string,
): Promise<{ name: string; daily_budget: string; id: string }> => {
  return fetchGraphApiJson(makeGraphApiUrl(`/${setId}`, { fields: ["name", "daily_budget"] }));
};

export type AdAccount = {
  id: string;
  name: string;
};

export const getAdAccounts = async (businessAccountId: string): Promise<AdAccount[]> => {
  const res = await fetchGraphApiJson(
    makeGraphApiUrl(`/${businessAccountId}/owned_ad_accounts`, { fields: ["id", "name"] }),
  );
  return recursiveFetch<AdAccount>(res);
};

type CheckingResponse = {
  async_status: "Job Completed" | "Job Started" | "Job Failed" | "Job Not Started";
  async_percent_completion: number;
  id: number;
};

// https://techblog.gmo-ap.jp/2022/06/10/facebook_graphapi_batch_async_request/
const asyncInsights = async <T extends InsightResponseData>(
  url: string | URL,
  timeoutSec: number,
): Promise<FBSuccessResponse<T>> => {
  const json: { report_run_id: string } = await fetchGraphApiJson(url, { method: "POST" });

  let status: "waiting" | "competed" | "failed" = "waiting";
  const start = Date.now();
  while (status === "waiting" && Date.now() - start < timeoutSec * 1000) {
    await sleep(5);
    const checkUrl = makeGraphApiUrl(`/${json.report_run_id}`);
    const checking: CheckingResponse = await fetchGraphApiJson(checkUrl);

    if (checking.async_status === "Job Completed") status = "competed";
    if (checking.async_status === "Job Failed") status = "failed";

    if (status === "waiting")
      console.log(checking.id, checking.async_status, `${checking.async_percent_completion}/100`);
  }

  if (status === "waiting") {
    console.warn("Job Timeout", url.toString());
    throw new FBInsightTimeoutError("Job Timeout", url);
  }
  if (status === "failed") {
    console.warn("Job Failed", url.toString());
    throw new FBInsightError("Job Failed", url);
  }

  return fetchGraphApiJson(makeGraphApiUrl(`/${json.report_run_id}/insights`));
};

export type InsightResponse = {
  paging?: FBPaging;
  data: InsightResponseData[];
};

type InsightResponseData = {
  impressions: string;
  spend: string;
  reach: string;
  inline_link_clicks: string;
  action_values: { action_type: string; value: string }[];
  actions: { action_type: string; value: string }[];
  inline_link_click_ctr: string;
  cost_per_inline_link_click: string;
  cpm: string;
  cpp: string;
  cost_per_action_type: { action_type: string; value: string }[];
  date_start: string;
  date_stop: string;
};

const defaultInsightFields = [
  "impressions",
  "spend",
  "reach",
  "inline_link_clicks",
  "action_values",
  "actions",
  "inline_link_click_ctr",
  "cost_per_inline_link_click",
  "cpm",
  "cpp",
  "cost_per_action_type",
];

type AdSetInsightData = InsightResponseData & {
  account_name: string;
  adset_id: string;
  adset_name: string;
};

export const getAdSetDailyInsights = async (
  adAccountId: string,
  params: {
    begin: string;
    end: string;
  },
): Promise<AdSetInsightData[]> => {
  const fields = [...defaultInsightFields, "account_name", "adset_id", "adset_name"];

  const url = makeGraphApiUrl(`${adAccountId}/insights`, {
    fields,
    timeRange: { since: params.begin, until: params.end },
    level: "adset",
    timeIncrement: 1,
  });
  const res = await asyncInsights<AdSetInsightData>(url, 300);
  return recursiveFetch(res);
};

type AdInsightData = InsightResponseData & {
  account_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
};

export const getAdDailyInsights = async (
  adAccountId: string,
  params: {
    begin: string;
    end: string;
  },
): Promise<AdInsightData[]> => {
  const fields = [
    ...defaultInsightFields,
    "account_name",
    "adset_id",
    "adset_name",
    "ad_name",
    "ad_id",
  ];

  const url = makeGraphApiUrl(`${adAccountId}/insights`, {
    fields,
    timeRange: { since: params.begin, until: params.end },
    level: "ad",
    timeIncrement: 1,
  });
  const res = await asyncInsights<AdInsightData>(url, 300);
  return recursiveFetch(res);
};
