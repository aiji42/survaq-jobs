import { getActiveFacebookAdAlerts } from "@survaq-jobs/libraries";
const { WebClient } = require("@slack/web-api");
import { config } from "dotenv";
config();

const { SLACK_API_TOKEN = "" } = process.env;

(async () => {
  const alerts = await getActiveFacebookAdAlerts();
  console.log(alerts);

  const channel = "#notify_class_a";
  const text = "*Hello World*";

  const client = new WebClient(SLACK_API_TOKEN);
  await client.chat.postMessage({ channel, text });
})();
