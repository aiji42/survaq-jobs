const { DIRECTUS_URL = "" } = process.env;

export const cmsProductLink = (id: number) =>
  `${DIRECTUS_URL}/admin/content/ShopifyProducts/${id}`;

export const cmsVariationLink = (id: number) =>
  `${DIRECTUS_URL}/admin/content/ShopifyVariants/${id}`;
