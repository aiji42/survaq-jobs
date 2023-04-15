import * as Shopify from "shopify-api-node";

const { SHOPIFY_SHOP_NAME = "" } = process.env;

export const createClient = () =>
  new Shopify.default({
    shopName: process.env["SHOPIFY_SHOP_NAME"] ?? "",
    apiKey: process.env["SHOPIFY_API_KEY"] ?? "",
    password: process.env["SHOPIFY_API_SECRET_KEY"] ?? "",
  });

export const orderAdminLink = (id: string) => {
  return `https://${SHOPIFY_SHOP_NAME}.myshopify.com/admin/orders/${id.replace(
    "gid://shopify/Order/",
    ""
  )}`;
};
