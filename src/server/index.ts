import { createServerApp } from "./app";
import { loadBotConfig } from "./config";
const config = loadBotConfig(process.env);
const { app } = createServerApp(config);
await app.start(config.port);
