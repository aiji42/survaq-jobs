import * as sql from "sqlstring";
import { BigQuery } from "@google-cloud/bigquery";
import { config } from "dotenv";
config();

const { BIGQUERY_CREDENTIALS, NODE_ENV, DRY_RUN } = process.env;

const credentials = JSON.parse(
  BIGQUERY_CREDENTIALS ?? '{"client_email":"","private_key":"","project_id":""}'
) as { client_email: string; private_key: string; project_id: "" };

export const client = new BigQuery(
  NODE_ENV === "production"
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
  conditions: Record<
    string,
    string | { value: string; operator: string } | string[]
  >
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
    [[], []]
  );

  const [res] = await client.query({
    query: sql.format(
      `SELECT ${columns.join(",")} FROM ${dataset}.${table}
            WHERE ${queries.join(" AND ")};`,
      values
    ),
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
) => {
  if (DRY_RUN) {
    console.log("DRY RUN: insert records", dataset, table);
    console.log("columns", columns);
    if (Object.keys(data[0] ?? {}).length < 20) {
      console.table(data.slice(0, 10));
      if (data.length > 10) console.log("and more...");
      return;
    }
  }
  return client.query({
    query: makeInsertQuery(table, dataset, columns as string[], data),
  });
};

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
