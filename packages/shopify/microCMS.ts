import { createClient } from "microcms-js-sdk";

const cmsClient = createClient({
  serviceDomain: "survaq-shopify",
  apiKey: process.env.MICROCMS_API_TOKEN ?? "",
});

type ProductOnMicroCMS = {
  productIds: string;
  productName: string;
};

export const getProductOnMicroCMS = async (id: string) => {
  const {
    contents: [product],
  } = await cmsClient.getList<ProductOnMicroCMS>({
    endpoint: "products",
    queries: {
      filters:
        "productIds[contains]" + id.replace("gid://shopify/Product/", ""),
    },
  });

  return {
    productGroupId: product?.id ?? null,
    productGroupName: product?.productName ?? null,
  };
};

export const getProductsOnMicroCMSByUpdatedAt = async (at: string) => {
  const { contents } = await cmsClient.getList<ProductOnMicroCMS>({
    endpoint: "products",
    queries: {
      filters: `updatedAt[greater_than]${at}`,
    },
  });

  return contents.map(({ productIds }) => {
    return {
      productIds: productIds.split(","),
    };
  });
};
