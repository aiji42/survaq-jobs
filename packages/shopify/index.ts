import {
  getLatestUpdatedAt,
  insertRecords,
  deleteByField,
} from "./bigquery-client";
import { createClient as createShopifyClient } from "./shopify";

const sleep = (timeout: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, timeout));
};

type EdgesNode<T> = {
  edges: {
    node: T;
    cursor: string;
  }[];
};

type WithPageInfo<T> = T & {
  pageInfo: {
    hasNextPage: boolean;
  };
};

const shopify = createShopifyClient();

const productListQuery = (query: string, cursor: null | string) => `{
  products(first: 50, query: "${query}" after: ${
  cursor ? `"${cursor}"` : "null"
}) {
    edges {
      node {
        id
        title
        status
        created_at: createdAt
        updated_at: updatedAt
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
  }
}`;

type ProductNode = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export const products = async (): Promise<void> => {
  const query = `updated_at:>'${await getLatestUpdatedAt("products")}'`;
  console.log("Graphql query: ", query);
  let hasNext = true;
  let cursor: null | string = null;
  let products: ProductNode[] = [];
  while (hasNext) {
    const data: { products: WithPageInfo<EdgesNode<ProductNode>> } =
      await shopify.graphql(productListQuery(query, cursor));
    hasNext = data.products.pageInfo.hasNextPage;

    products = data.products.edges.reduce((res, { node, cursor: c }) => {
      cursor = c;
      return [...res, node];
    }, products);
    if (hasNext) await sleep(1000);
  }

  console.log("products records:", products.length);
  if (products.length > 0) {
    const ids = products.map(({ id }) => id);
    await deleteByField("products", "shopify", "id", ids);
    await insertRecords(
      "products",
      "shopify",
      ["id", "title", "status", "created_at", "updated_at"],
      products
    );
  }
};

const variantListQuery = (query: string, cursor: null | string) => `{
  productVariants(first: 50, query: "${query}", after: ${
  cursor ? `"${cursor}"` : "null"
}) {
    edges {
      node {
        id
        title
        display_name: displayName
        price
        compareAtPrice
        taxable
        available_for_sale: availableForSale
        product {
          id
        }
        created_at: createdAt
        updated_at: updatedAt
      }
      cursor
    }
    pageInfo {
      hasNextPage
    }
  }
}`;

type VariantListNode = {
  id: string;
  title: string;
  display_name: string;
  price: string;
  compareAtPrice: string;
  taxable: boolean;
  available_for_sale: boolean;
  product: {
    id: string;
  };
  created_at: string;
  updated_at: string;
};

type VariantRecord = {
  id: string;
  title: string;
  display_name: string;
  price: number;
  compare_at_price: number | null;
  taxable: boolean;
  available_for_sale: boolean;
  product_id: string;
  created_at: string;
  updated_at: string;
};

export const variants = async (): Promise<void> => {
  const query = `updated_at:>'${await getLatestUpdatedAt("variants")}'`;
  console.log("Graphql query: ", query);
  let hasNext = true;
  let cursor: null | string = null;
  let variants: VariantRecord[] = [];
  while (hasNext) {
    const data: { productVariants: WithPageInfo<EdgesNode<VariantListNode>> } =
      await shopify.graphql(variantListQuery(query, cursor));
    hasNext = data.productVariants.pageInfo.hasNextPage;

    variants = data.productVariants.edges.reduce<VariantRecord[]>(
      (res, { node, cursor: c }) => {
        cursor = c;
        return [
          ...res,
          {
            ...node,
            product_id: node.product.id,
            price: Number(node.price),
            compare_at_price: node.compareAtPrice
              ? Number(node.compareAtPrice)
              : null,
          },
        ];
      },
      variants
    );
    if (hasNext) await sleep(1000);
  }

  console.log("variants records:", variants.length);
  if (variants.length > 0) {
    const ids = variants.map(({ id }) => id);
    await deleteByField("variants", "shopify", "id", ids);
    await insertRecords(
      "variants",
      "shopify",
      [
        "id",
        "product_id",
        "title",
        "display_name",
        "price",
        "compare_at_price",
        "taxable",
        "available_for_sale",
        "created_at",
        "updated_at",
      ],
      variants
    );
  }
};

const main = async () => {
  await Promise.all([products(), variants()]);
};
main().catch((e) => {
  console.log(e);
  process.exit(1);
});
