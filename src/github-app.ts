import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { Env } from "./config.js";

export async function getInstallationOctokit(
  env: Env,
  installationId: number,
): Promise<Octokit> {
  const auth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });

  const { token } = await auth({
    type: "installation",
    installationId,
  });

  return new Octokit({ auth: token });
}
