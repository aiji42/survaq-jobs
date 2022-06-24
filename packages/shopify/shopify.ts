import * as Shopify from "shopify-api-node";

export const createClient = () =>
  new Shopify.default({
    shopName: process.env.SHOPIFY_SHOP_NAME ?? "",
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    password: process.env.SHOPIFY_API_SECRET_KEY ?? "",
  });

// gid://shopify/Product/12341234 => 12341234
export const productIdStripPrefix = (id: string): string => id.slice(22);

// gid://shopify/ProductVariant/12341234 => 12341234
export const variantIdStripPrefix = (id: string): string => id.slice(29);

// gid://shopify/Order/12341234 => 12341234
export const orderIdStripPrefix = (id: string): string => id.slice(20);
