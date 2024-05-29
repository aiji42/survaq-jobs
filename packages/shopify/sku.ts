import { client, BigQueryTimestamp } from "@survaq-jobs/libraries";

export const getShippedCounts = async (
  codeAndShippedAtSet: Array<{ code: string; shippedAt: string }>,
): Promise<Array<{ code: string; count: number; lastShippedAt: BigQueryTimestamp }>> => {
  if (codeAndShippedAtSet.length === 0) return [];
  const [res] = await client.query({
    query: `
      SELECT code, SUM(quantity) as count, MAX(fulfilled_at) as lastShippedAt
      FROM shopify.order_skus
      WHERE ${codeAndShippedAtSet
        .map(({ code, shippedAt }) => `(fulfilled_at > '${shippedAt}' AND code = '${code}')`)
        .join(" OR ")}
      GROUP BY code
    `,
  });
  return res;
};
