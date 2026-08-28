import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import type { Env } from "./config.js";
import { getInstallationOctokit } from "./github-app.js";
import { fetchPRData } from "./fetch-pr.js";
import { createLLMClient, callLLM } from "./llm.js";
import { runReviewFlow } from "./post-review.js";

function isBotLogin(login: string | undefined): boolean {
  if (!login) return false;
  const lower = login.toLowerCase();
  return lower.endsWith("[bot]") || lower.endsWith("-bot");
}

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

    if (pull_request.draft) {
      console.log(`PR #${pull_request.number} is draft — skipping review`);
      return;
    }

    const sender = payload.sender;
    if (sender?.type === "Bot" || isBotLogin(sender?.login)) {
      console.log(
        `PR #${pull_request.number} from bot ${sender?.login} — skipping review`,
      );
      return;
    }

    const { number } = pull_request;
    const { login: owner } = repository.owner;
    const { name: repo } = repository;

    console.log(`PR #${number} ${payload.action} — ${repository.full_name}`);

    try {
      const octokit = await getInstallationOctokit(env, installationId);
      const prData = await fetchPRData(octokit, owner, repo, number);
      const llm = createLLMClient(env);

      const reviewUrl = await runReviewFlow(
        octokit,
        owner,
        repo,
        number,
        prData,
        () => callLLM(llm, env, prData),
      );

      console.log(`Review posted: ${reviewUrl}`);
    } catch (err) {
      console.error(`Failed to review PR #${number}:`, err);
    }
  });

  return webhooks;
}

export function createWebhookMiddleware(webhooks: Webhooks) {
  return createNodeMiddleware(webhooks);
}
