import { PromisePool } from "@supercharge/promise-pool";

export const sleep = (sec: number) => {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000));
};

export const sliceByNumber = <T>(array: T[], n: number): T[][] => {
  const length = Math.ceil(array.length / n);

  return new Array(length)
    .fill(0)
    .map((_, i) => array.slice(i * n, (i + 1) * n));
};

export const range = (start: number, end: number) =>
  [...Array(end + 1).keys()].slice(start);

export const limitAsyncMap = async <T, R>(
  params: T[],
  callback: (p: T) => Promise<R>,
  concurrency: number,
  retryable: number,
): Promise<R[]> => {
  if (retryable === 0) throw new Error("Max retry attempts reached");

  const { results, errors } = await PromisePool.for(params)
    .withConcurrency(concurrency)
    .process(callback);

  if (errors.length === 0) return results;

  const retried = await limitAsyncMap(
    errors.map(({ item }) => item),
    callback,
    concurrency,
    retryable - 1,
  );

  return results.concat(retried);
};
