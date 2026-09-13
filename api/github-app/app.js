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

async function isPrivilegedPrincipal(octokit, owner, repo, username) {
  if (!username) return false;
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

function createInstallationOctokit(installationId) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY,
      installationId,
    },
  });
}

function createGitHubAppService() {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const allowedRepos = parseAllowedRepos(process.env.ALLOWED_REPOS);
  const responder = createOpenAIResponder({ openAITimeoutMs: 10000 });
  const deliveries = createDeliveryStore();

  const enabled = Boolean(
    process.env.GITHUB_APP_ID && process.env.GITHUB_PRIVATE_KEY && webhookSecret
  );

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

      if (!deliveries.markIfNew(deliveryId)) {
        return res.status(200).json({ ok: true, duplicate: true });
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

      const installationId = payload?.installation?.id;
      if (!installationId) {
        return res.status(202).json({ ok: true, ignored: "missing_installation" });
      }

      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const octokit = createInstallationOctokit(installationId);

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
          payload.comment?.user?.login
        );
        if (!allowed) {
          return res.status(403).json({ ok: true, denied: true });
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
