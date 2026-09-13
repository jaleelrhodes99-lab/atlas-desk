const { Octokit } = require("@octokit/rest");
const { createAppAuth } = require("@octokit/auth-app");
const { verifyGitHubSignature, createDeliveryStore } = require("./security");
const {
  buildIssueReplyPrompt,
  buildTriagePrompt,
  buildSummaryPrompt,
} = require("./prompts");
const { createOpenAIResponder } = require("./openai");

function parseAllowedRepos(input) {
  if (!input) return null;
  const repos = input
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
  return repos.length ? new Set(repos) : null;
}

function isBotAccount(user) {
  const login = user?.login || "";
  return user?.type === "Bot" || login.endsWith("[bot]");
}

function inferLabels(title = "", body = "") {
  const text = `${title}\n${body}`;
  const labels = new Set();

  if (/\b(bug|error|broken|fail(?:ed|ure)?|exception)\b/i.test(text)) {
    labels.add("bug");
  }

  const hasReproSignal =
    /\b(repro|reproduction|steps to reproduce|expected|actual|stack trace|logs?)\b/i.test(
      text
    );
  if (!hasReproSignal) labels.add("needs-repro");

  return Array.from(labels);
}

async function ensureLabel(octokit, owner, repo, name) {
  const defaults = {
    bug: { color: "d73a4a", description: "Something is not working" },
    "needs-repro": {
      color: "fbca04",
      description: "Needs clear reproduction details",
    },
  };
  const details = defaults[name] || { color: "cccccc", description: "triage label" };
  try {
    await octokit.rest.issues.createLabel({
      owner,
      repo,
      name,
      color: details.color,
      description: details.description,
    });
  } catch (error) {
    if (error.status !== 422) throw error;
  }
}

async function addLabelsIfAny(octokit, owner, repo, issueNumber, labels) {
  if (!labels.length) return;
  for (const label of labels) {
    await ensureLabel(octokit, owner, repo, label);
  }
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels,
  });
}

async function isPrivilegedPrincipal(octokit, owner, repo, username, repositoryOwner) {
  if (!username) return false;
  if (
    repositoryOwner &&
    username.toLowerCase() === String(repositoryOwner).toLowerCase()
  ) {
    return true;
  }
  try {
    const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username,
    });
    return ["admin", "maintain", "write", "triage"].includes(data.permission);
  } catch {
    return false;
  }
}

function createInstallationOctokit(installationId, env = process.env) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_PRIVATE_KEY,
      installationId,
    },
  });
}

function createGitHubAppService(options = {}) {
  const env = options.env || process.env;
  const webhookSecret = options.webhookSecret || env.GITHUB_WEBHOOK_SECRET;
  const allowedRepos =
    options.allowedRepos instanceof Set
      ? options.allowedRepos
      : parseAllowedRepos(options.allowedRepos || env.ALLOWED_REPOS);
  const responder =
    options.responder ||
    createOpenAIResponder({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || "gpt-5-mini",
      openAITimeoutMs: 10000,
    });
  const deliveries = options.deliveries || createDeliveryStore();
  const installationOctokitFactory =
    options.createInstallationOctokit ||
    ((installationId) => createInstallationOctokit(installationId, env));

  const enabled =
    typeof options.enabled === "boolean"
      ? options.enabled
      : Boolean(env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY && webhookSecret);
  const repositoryOwner = options.repositoryOwner || null;

  return {
    enabled,
    async handleWebhook(req, res) {
      if (!enabled) {
        return res.status(503).json({
          ok: false,
          error: "github_app_not_configured",
        });
      }

      const deliveryId = req.get("x-github-delivery");
      const signatureHeader = req.get("x-hub-signature-256");
      const eventType = req.get("x-github-event");
      const rawBody = req.body;

      if (!verifyGitHubSignature(rawBody, signatureHeader, webhookSecret)) {
        return res.status(401).json({ ok: false, error: "invalid_signature" });
      }

      if (!deliveryId) {
        return res.status(400).json({ ok: false, error: "missing_delivery_id" });
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ ok: false, error: "invalid_payload" });
      }

      const fullName = payload?.repository?.full_name;
      if (allowedRepos && !allowedRepos.has(fullName)) {
        return res.status(202).json({ ok: true, ignored: "repo_not_allowed" });
      }
      const [owner, repo] = String(fullName || "").split("/");
      if (!owner || !repo) {
        return res.status(400).json({ ok: false, error: "invalid_repository" });
      }

      const installationId = payload?.installation?.id;
      if (!installationId) {
        return res.status(202).json({ ok: true, ignored: "missing_installation" });
      }
      if (!deliveries.markIfNew(deliveryId)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      const octokit = installationOctokitFactory(installationId);

      if (eventType === "issues" && payload.action === "opened") {
        if (isBotAccount(payload.sender)) {
          return res.status(202).json({ ok: true, ignored: "bot_sender" });
        }

        const issue = payload.issue;
        const labels = inferLabels(issue.title, issue.body);
        await addLabelsIfAny(octokit, owner, repo, issue.number, labels);

        const message = await responder.respond(buildIssueReplyPrompt(issue));
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: issue.number,
          body: message,
        });
        return res.status(200).json({ ok: true, handled: "issues.opened" });
      }

      if (eventType === "issue_comment" && payload.action === "created") {
        if (isBotAccount(payload.sender) || isBotAccount(payload.comment?.user)) {
          return res.status(202).json({ ok: true, ignored: "bot_sender" });
        }

        if (payload.issue?.pull_request) {
          return res.status(202).json({ ok: true, ignored: "pr_comment" });
        }

        const body = (payload.comment?.body || "").trim();
        const command = body.split(/\s+/)[0].toLowerCase();
        if (!["/triage", "/summarize"].includes(command)) {
          return res.status(202).json({ ok: true, ignored: "not_supported_command" });
        }

        const allowed = await isPrivilegedPrincipal(
          octokit,
          owner,
          repo,
          payload.comment?.user?.login,
          repositoryOwner || owner
        );
        if (!allowed) {
          return res.status(403).json({
            ok: false,
            error: "insufficient_permissions",
            denied: true,
          });
        }

        if (command === "/triage") {
          const labels = inferLabels(payload.issue.title, payload.issue.body);
          await addLabelsIfAny(octokit, owner, repo, payload.issue.number, labels);
          const triage = await responder.respond(
            buildTriagePrompt(payload.issue, payload.comment.body)
          );
          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: payload.issue.number,
            body: triage,
          });
          return res.status(200).json({ ok: true, handled: "issue_comment.created/triage" });
        }

        const summary = await responder.respond(buildSummaryPrompt(payload.issue));
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: payload.issue.number,
          body: summary,
        });
        return res.status(200).json({ ok: true, handled: "issue_comment.created/summarize" });
      }

      return res.status(202).json({ ok: true, ignored: "unsupported_event" });
    },
  };
}

module.exports = {
  createGitHubAppService,
};
