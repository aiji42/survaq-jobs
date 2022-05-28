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

export const deleteByDate = async (
  table: string,
  dataset: string,
  date: string
) => {
  await client.query({
    query: sql.format(
      `
    DELETE FROM ${dataset}.${table} where date = ?;
    `,
      [date]
    ),
  });
};
