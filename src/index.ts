import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadEnv } from "./config.js";
import { createWebhooks, createWebhookMiddleware } from "./webhook.js";

const env = loadEnv();

const webhooks = createWebhooks(env);
const webhookMiddleware = createWebhookMiddleware(webhooks);

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") || "";
  const eventName = c.req.header("x-github-event") || "";

  const verified = await webhooks.verify(rawBody, signature);
  if (!verified) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  await webhooks.receive({
    id: c.req.header("x-github-delivery") || "",
    name: eventName as any,
    payload: JSON.parse(rawBody),
  });

  return c.json({ status: "accepted" });
});

console.log(`agent-pr-review starting on port ${env.PORT}...`);
serve({ fetch: app.fetch, port: env.PORT });
