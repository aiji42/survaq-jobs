import * as sql from "sqlstring";
import { BigQuery } from "@google-cloud/bigquery";
import { config } from "dotenv";
export type { BigQueryTimestamp } from "@google-cloud/bigquery";
config();

const { BIGQUERY_CREDENTIALS, NODE_ENV, DRY_RUN } = process.env;

const credentials = JSON.parse(
  BIGQUERY_CREDENTIALS ??
    '{"client_email":"","private_key":"","project_id":""}',
) as { client_email: string; private_key: string; project_id: "" };

export const client = new BigQuery(
  NODE_ENV === "production"
    ? {}
    : {
        credentials,
        projectId: credentials.project_id,
      },
);

export const getRecords = async <
  T extends Record<string, unknown> = Record<string, any>,
>(
  table: string,
  dataset: string,
  columns: string[],
  conditions: Record<
    string,
    string | { value: string; operator: string } | string[]
  >,
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

export const updateRecords = async (
  table: string,
  dataset: string,
  data: Record<string, any>,
  whereField: string,
  whereValue: string | string[],
) => {
  const query = makeUpdateQuery(table, dataset, data, whereField, whereValue);
  if (DRY_RUN) {
    console.log("DRY RUN: update records", dataset, table);
    console.log(query);
  } else {
    await client.query({
      query,
    });
  }
};

const makeUpdateQuery = (
  table: string,
  dataset: string,
  data: Record<string, any>,
  whereField: string,
  whereValue: string | string[],
) => {
  return sql.format(
    `
    UPDATE ${dataset}.${table} SET ${Object.keys(data)
      .map((k) => `${k} = ?`)
      .join(", ")}
    WHERE ${whereField} ${Array.isArray(whereValue) ? "IN (?)" : "= ?"}
    `,
    [...Object.values(data), whereValue],
  );
};

export const insertRecords = async <
  T extends Record<string, string | number | boolean | null>,
>(
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
        .map((d) =>
          Object.fromEntries(
            Object.entries(d).filter(([k]) => columns.includes(k)),
          ),
        ),
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

export const truncateTable = async (table: string, dataset: string) => {
  if (DRY_RUN) {
    console.log("DRY RUN: TRUNCATE TABLE", dataset, table);
    return;
  }

  await client.query({
    query: `TRUNCATE TABLE ${dataset}.${table}`,
  });
};

export const getLatestTimeAt = async (
  table: string,
  dataset: string,
  column: string,
): Promise<string> => {
  const [res] = await client.query({
    query: `SELECT ${column} FROM ${dataset}.${table}
            ORDER BY ${column} DESC LIMIT 1;`,
  });
  if (res.length < 1) return "2000-01-01T00:00:00.000Z";

  const latest = res[0][column].value;
  return latest.replace(/\.\d{3}Z$/, "Z");
};
