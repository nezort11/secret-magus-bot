import { bot } from "./bot";

import http from "serverless-http";

export const handler = http(bot.webhookCallback("/webhook"));

if (require.main === module) {
  bot.launch();
}
