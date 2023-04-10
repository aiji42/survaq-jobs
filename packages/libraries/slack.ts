import { MessageAttachment, WebClient } from "@slack/web-api";
import { config } from "dotenv";
export { MessageAttachment } from "@slack/web-api";

config();

const { SLACK_API_TOKEN = "", DRY_RUN } = process.env;

const slackClient = new WebClient(SLACK_API_TOKEN);

export const postMessage = async (
  channel: string,
  text: string,
  attachments: MessageAttachment[]
) => {
  if (DRY_RUN) {
    console.log("DRY_RUN: post message", channel, JSON.stringify(attachments));
  } else {
    await slackClient.chat.postMessage({ channel, text, attachments });
  }
};
