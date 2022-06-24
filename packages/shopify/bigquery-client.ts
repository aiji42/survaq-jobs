import * as sql from "sqlstring";
import { BigQuery, SimpleQueryRowsResponse } from "@google-cloud/bigquery";
import { config } from "dotenv";
config();

const credentials = JSON.parse(
  process.env.BIGQUERY_CREDENTIALS ??
    '{"client_email":"","private_key":"","project_id":""}'
) as { client_email: string; private_key: string; project_id: "" };

export const client = new BigQuery(
  process.env.NODE_ENV === "production"
    ? {}
    : {
        credentials,
        projectId: credentials.project_id,
      }
);

export const insertRecords = (
  table: string,
  dataset: string,
  columns: string[],
  data: Record<string, string | number | boolean | null>[]
): Promise<SimpleQueryRowsResponse> =>
  client.query({ query: makeInsertQuery(table, dataset, columns, data) });

const makeInsertQuery = (
  table: string,
  dataset: string,
  columns: string[],
  data: Record<string, string | number | boolean | null>[]
) => {
  return sql.format(
    `
    INSERT INTO ${dataset}.${table} (${columns.join(",")})
    VALUES ?
    `,
    [data.map((record) => columns.map((col) => record[col]))]
  );
};

export const getLatestUpdatedAt = async (
  table: string,
  dataset = "shopify"
): Promise<string> => {
  const [res] = await client.query({
    query: `select updated_at from ${dataset}.${table}
            order by updated_at desc limit 1;`,
  });
  if (res.length < 1) return "2000-01-01T00:00:00.000T";

  const [
    {
      updated_at: { value: latest },
    },
  ] = res;
  return latest.replace(/\.000Z$/, ".999Z");
};

export const deleteByField = async (
  table: string,
  dataset: string,
  field: string,
  values: (string | number)[]
) => {
  await client.query({
    query: sql.format(
      `
    DELETE FROM ${dataset}.${table} WHERE ${field} IN (?);
    `,
      [values]
    ),
  });
};
