import * as sql from "sqlstring";
import { BigQuery } from "@google-cloud/bigquery";
import { config } from "dotenv";
export type { BigQueryTimestamp } from "@google-cloud/bigquery";
config();

const { BIGQUERY_CREDENTIALS, NODE_ENV, DRY_RUN } = process.env;

const credentials = JSON.parse(
  BIGQUERY_CREDENTIALS ?? '{"client_email":"","private_key":"","project_id":""}',
) as { client_email: string; private_key: string; project_id: "" };

export const client = new BigQuery(
  NODE_ENV === "production"
    ? {}
    : {
        credentials,
        projectId: credentials.project_id,
      },
);

export const getRecords = async <T extends Record<string, unknown> = Record<string, any>>(
  table: string,
  dataset: string,
  columns: string[],
  conditions: Record<string, string | { value: string; operator: string } | string[]>,
): Promise<T[]> => {
  const [queries, values] = Object.entries(conditions).reduce<
    [Array<string>, Array<string | string[]>]
  >(
    (res, [left, right]) => {
      const [queries, values] = res;
      if (Array.isArray(right)) {
        return [
          [...queries, `${left} IN (?)`],
          [...values, right],
        ];
      }
      if (typeof right === "string") {
        return [
          [...queries, `${left} = ?`],
          [...values, right],
        ];
      }
      return [
        [...queries, `${left} ${right.operator} ?`],
        [...values, right.value],
      ];
    },
    [[], []],
  );

  const [res] = await client.query({
    query: sql.format(
      `SELECT ${columns.join(",")} FROM ${dataset}.${table}
            WHERE ${queries.join(" AND ")};`,
      values,
    ),
  });

  return res;
};

export const insertRecords = async <T extends Record<string, string | number | boolean | null>>(
  table: string,
  dataset: string,
  columns: Array<keyof T>,
  data: T[],
  printLog = false,
) => {
  const query = makeInsertQuery(table, dataset, columns as string[], data);
  if (DRY_RUN) {
    console.log("DRY RUN: insert records", dataset, table);
    console.log("columns", columns);
    console.table(
      data
        .slice(0, 10)
        .map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => columns.includes(k)))),
    );
    if (data.length > 10) console.log("and more...");
    console.log(query);
  } else {
    if (printLog) console.log(query);
    await client.query({
      query,
    });
  }
};

const makeInsertQuery = (
  table: string,
  dataset: string,
  columns: string[],
  data: Record<string, string | number | boolean | null>[],
) => {
  return sql.format(
    `
    INSERT INTO ${dataset}.${table} (${columns.join(",")})
    VALUES ?
    `,
    [data.map((record) => columns.map((col) => record[col]))],
  );
};

export const deleteByField = async (
  table: string,
  dataset: string,
  field: string,
  values: (string | number)[] | string | number,
) => {
  if (DRY_RUN) {
    console.log("DRY RUN: delete record by", field, "from", dataset, table);
    return;
  }

  await client.query({
    query: Array.isArray(values)
      ? sql.format(
          `
    DELETE FROM ${dataset}.${table} WHERE ${field} IN (?);
    `,
          [values],
        )
      : sql.format(
          `
    DELETE FROM ${dataset}.${table} WHERE ${field} = ?;
    `,
          [values],
        ),
  });
};
