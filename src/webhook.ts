import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import type { Env } from "./config.js";
import { getInstallationOctokit } from "./github-app.js";
import { fetchPRData } from "./fetch-pr.js";
import { createLLMClient, callLLM } from "./llm.js";
import { postReview } from "./post-review.js";

export function createWebhooks(env: Env): Webhooks {
  const webhooks = new Webhooks({ secret: env.GITHUB_WEBHOOK_SECRET });

  const isPRCreation = (action: string): boolean =>
    action === "opened" || action === "synchronize" || action === "reopened";

  webhooks.on("pull_request", async (event) => {
    const { payload } = event;
    if (!isPRCreation(payload.action)) return;

    const repository = payload.repository;
    const pull_request = payload.pull_request;
    const installationId = (payload as any).installation?.id as number | undefined;
    if (!installationId || !repository || !pull_request) {
      console.warn("Missing installation, repository, or pull_request in payload");
      return;
    }

    console.log(
      `PR #${pull_request.number} ${payload.action} — ${repository.full_name}`,
    );

    try {
      const octokit = await getInstallationOctokit(env, installationId);
      const prData = await fetchPRData(
        octokit,
        repository.owner.login,
        repository.name,
        pull_request.number,
      );

      const llm = createLLMClient(env);
      const review = await callLLM(llm, env, prData);

      const reviewUrl = await postReview(
        octokit,
        repository.owner.login,
        repository.name,
        pull_request.number,
        prData.headSha,
        review,
      );

      console.log(`Review posted: ${reviewUrl}`);
    } catch (err) {
      console.error(`Failed to review PR #${pull_request.number}:`, err);
    }
  });

  return webhooks;
}

export function createWebhookMiddleware(webhooks: Webhooks) {
  return createNodeMiddleware(webhooks);
}
