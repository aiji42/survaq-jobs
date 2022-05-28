import { createHash } from "crypto";
import { config } from "dotenv";
import dayjs from "dayjs";
import jwt from "jsonwebtoken";
import { Report } from "./report";
import { deleteByDate, insertRecords } from "./bigquery-client";

config();

const { API_SECRET_KEY = "", API_ACCESS_KEY = "" } = process.env;
const REPORT_SIZE = 50;

const getReport = async (
  adaccountId: string,
  date: string
): Promise<Report> => {
  const uri = `/api/v3/adaccounts/${adaccountId}/reports/online/adgroup`;

  const payload = [
    createHash("sha256").update("").digest("hex"),
    "",
    dayjs().format("YYYYMMDD"),
    uri,
  ].join("\n");

  const token = jwt.sign(payload, API_SECRET_KEY, {
    header: { alg: "HS256", kid: API_ACCESS_KEY, typ: "text/plain" },
  });

  const res = await fetch(
    `https://ads.line.me${uri}?since=${date}&until=${date}&size=${REPORT_SIZE}`,
    {
      headers: {
        Date: dayjs().toString(),
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) throw new Error(await res.text());

  const report: Report = await res.json();
  if (report.paging.totalElements > REPORT_SIZE)
    throw new Error(
      "The amount of ad groups present exceeds the report size. Resize or split them to get them."
    );

  return report;
};

const createRecords = (reports: Report, date: string) => {
  return reports.datas.reduce<Record<string, number | string | boolean>[]>(
    (res, data) => {
      return [
        ...res,
        {
          date,
          ...Object.fromEntries(
            Object.entries(data.adaccount).map(([k, v]) => [
              `adaccount_${k}`,
              k.endsWith("Date") && typeof v === "string"
                ? new Date(v)
                : k.match(/(^id$|Id$|Micro$)/)
                ? String(v)
                : v,
            ])
          ),
          ...Object.fromEntries(
            Object.entries(data.campaign).map(([k, v]) => [
              `campaign_${k}`,
              k.endsWith("Date") && typeof v === "string"
                ? new Date(v)
                : k.match(/(^id$|Id$|Micro$)/)
                ? String(v)
                : v,
            ])
          ),
          ...Object.fromEntries(
            Object.entries(data.adgroup).map(([k, v]) => [
              `adgroup_${k}`,
              k.endsWith("Date") && typeof v === "string"
                ? new Date(v)
                : k.match(/(^id$|Id$|Micro$)/)
                ? String(v)
                : v,
            ])
          ),
          ...Object.fromEntries(
            Object.entries(data.statistics).map(([k, v]) => [
              k,
              k.endsWith("Date") && typeof v === "string"
                ? new Date(v)
                : k.match(/(^id$|Id$|Micro$)/)
                ? String(v)
                : v,
            ])
          ),
        },
      ];
    },
    []
  );
};

const getColumns = (records: Record<string, unknown>[]) => {
  return records.reduce<string[]>((res, record) => {
    const keys = Object.keys(record);
    return keys.length > res.length ? keys : res;
  }, []);
};

const main = async () => {
  const date = dayjs().format("YYYY-MM-DD");
  const report = await getReport("A57000210607", date);
  console.log("hits report ", report.paging.totalElements, " records");
  const records = createRecords(report, date);

  if (records.length > 0) {
    console.log("delete records date=", date);
    await deleteByDate("ad_reports", "line", date);
    console.log("insert records");
    await insertRecords("ad_reports", "line", getColumns(records), records);
  }
};

main().catch(console.error);
