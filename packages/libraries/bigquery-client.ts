import * as sql from "sqlstring";
import { BigQuery, SimpleQueryRowsResponse } from "@google-cloud/bigquery";
import { config } from "dotenv";
config();

const credentials = JSON.parse(
  process.env["BIGQUERY_CREDENTIALS"] ??
    '{"client_email":"","private_key":"","project_id":""}'
) as { client_email: string; private_key: string; project_id: "" };

export const client = new BigQuery(
  process.env["NODE_ENV"] === "production"
    ? {}
    : {
        credentials,
        projectId: credentials.project_id,
      }
);

export const getRecords = async <
  T extends Record<string, unknown> = Record<string, any>
>(
  table: string,
  dataset: string,
  columns: string[],
  conditions: Record<string, string | { value: string; operator: string }>
): Promise<T[]> => {
  const [res] = await client.query({
    query: `SELECT ${columns.join(",")} FROM ${dataset}.${table}
            WHERE ${Object.entries(conditions)
              .map(([left, right]) =>
                typeof right === "string"
                  ? `${left} = '${right}'`
                  : `${left} ${right.operator} '${right.value}'`
              )
              .join(" AND ")};`,
  });

  return res;
};

export const insertRecords = <
  T extends Record<string, string | number | boolean | null>
>(
  table: string,
  dataset: string,
  columns: Array<keyof T>,
  data: T[]
): Promise<SimpleQueryRowsResponse> =>
  client.query({
    query: makeInsertQuery(table, dataset, columns as string[], data),
  });

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

export const deleteByField = async (
  table: string,
  dataset: string,
  field: string,
  values: (string | number)[] | string | number
) => {
  await client.query({
    query: Array.isArray(values)
      ? sql.format(
          `
    DELETE FROM ${dataset}.${table} WHERE ${field} IN (?);
    `,
          [values]
        )
      : sql.format(
          `
    DELETE FROM ${dataset}.${table} WHERE ${field} = ?;
    `,
          [values]
        ),
  });
};

export const getLatestTimeAt = async (
  table: string,
  dataset: string,
  column: string
): Promise<string> => {
  const [res] = await client.query({
    query: `SELECT ${column} FROM ${dataset}.${table}
            ORDER BY ${column} DESC LIMIT 1;`,
  });
  if (res.length < 1) return "2000-01-01T00:00:00.000Z";

  const latest = res[0][column].value;
  return latest.replace(/\.\d{3}Z$/, ".999Z");
};
