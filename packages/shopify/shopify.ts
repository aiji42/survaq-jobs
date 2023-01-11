import * as Shopify from "shopify-api-node";

export const createClient = () =>
  new Shopify.default({
    shopName: process.env["SHOPIFY_SHOP_NAME"] ?? "",
    apiKey: process.env["SHOPIFY_API_KEY"] ?? "",
    password: process.env["SHOPIFY_API_SECRET_KEY"] ?? "",
  });
