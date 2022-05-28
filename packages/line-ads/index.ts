import { createHash } from "crypto";
import { config } from "dotenv";
import dayjs from "dayjs";
import jwt from "jsonwebtoken";

config();

const { API_SECRET_KEY = "", API_ACCESS_KEY = "" } = process.env;

const getReport = async (adaccountId: string, date: string) => {
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
    `https://ads.line.me${uri}?since=${date}&until=${date}`,
    {
      headers: {
        Date: dayjs().toString(),
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) throw new Error(await res.text());

  return await res.json();
};

getReport("A57000210607", "2022-05-25").then((data) =>
  console.dir(data.datas, { depth: 10 })
);
