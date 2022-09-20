import { Storage } from "@google-cloud/storage";
import { config } from "dotenv";
config();

const credentials = JSON.parse(
  process.env.BIGQUERY_CREDENTIALS ??
    '{"client_email":"","private_key":"","project_id":""}'
) as { client_email: string; private_key: string; project_id: "" };

export const storage = new Storage(
  process.env.NODE_ENV === "production"
    ? {}
    : {
        credentials,
        projectId: credentials.project_id,
      }
);
