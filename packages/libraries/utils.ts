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
