const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createGitHubAppService } = require("../../api/github-app/app");

function sign(secret, bodyBuffer) {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(bodyBuffer)
    .digest("hex")}`;
}

function createMockResponse() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
  };
}

test("issues.opened applies labels and posts generated comment", async () => {
  const secret = "webhook-secret";
  const payload = {
    action: "opened",
    installation: { id: 99 },
    sender: { login: "alice", type: "User" },
    repository: { full_name: "jaleelrhodes99-lab/atlas-desk" },
    issue: {
      number: 12,
      title: "Bug: crash on startup",
      body: "App fails after launch",
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const labelsCreated = [];
  const labelsApplied = [];
  const comments = [];

  const octokit = {
    rest: {
      issues: {
        async createLabel(params) {
          labelsCreated.push(params.name);
        },
        async addLabels(params) {
          labelsApplied.push(...params.labels);
        },
        async createComment(params) {
          comments.push(params.body);
        },
      },
    },
  };

  const service = createGitHubAppService({
    enabled: true,
    webhookSecret: secret,
    allowedRepos: new Set(["jaleelrhodes99-lab/atlas-desk"]),
    createInstallationOctokit: () => octokit,
    responder: {
      async respond() {
        return "Thanks — triaged and queued for follow-up.";
      },
    },
  });

  const req = {
    body: rawBody,
    get(name) {
      return {
        "x-github-delivery": "delivery-100",
        "x-github-event": "issues",
        "x-hub-signature-256": sign(secret, rawBody),
      }[name.toLowerCase()];
    },
  };
  const res = createMockResponse();

  await service.handleWebhook(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.handled, "issues.opened");
  assert.deepEqual(labelsApplied.sort(), ["bug", "needs-repro"]);
  assert.deepEqual(labelsCreated.sort(), ["bug", "needs-repro"]);
  assert.equal(comments.length, 1);
  assert.equal(comments[0], "Thanks — triaged and queued for follow-up.");
});

test("issue_comment created denies /triage for unauthorized principal", async () => {
  const secret = "webhook-secret";
  const payload = {
    action: "created",
    installation: { id: 100 },
    sender: { login: "outside-user", type: "User" },
    repository: { full_name: "jaleelrhodes99-lab/atlas-desk" },
    issue: {
      number: 20,
      title: "Intermittent error",
      body: "Sometimes fails",
    },
    comment: {
      body: "/triage",
      user: { login: "outside-user", type: "User" },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  let commentCount = 0;
  const octokit = {
    rest: {
      repos: {
        async getCollaboratorPermissionLevel() {
          return { data: { permission: "read" } };
        },
      },
      issues: {
        async createLabel() {},
        async addLabels() {},
        async createComment() {
          commentCount += 1;
        },
      },
    },
  };
  const service = createGitHubAppService({
    enabled: true,
    webhookSecret: secret,
    allowedRepos: new Set(["jaleelrhodes99-lab/atlas-desk"]),
    createInstallationOctokit: () => octokit,
    responder: {
      async respond() {
        return "unused";
      },
    },
  });

  const req = {
    body: rawBody,
    get(name) {
      return {
        "x-github-delivery": "delivery-101",
        "x-github-event": "issue_comment",
        "x-hub-signature-256": sign(secret, rawBody),
      }[name.toLowerCase()];
    },
  };
  const res = createMockResponse();

  await service.handleWebhook(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.jsonBody.error, "insufficient_permissions");
  assert.equal(commentCount, 0);
});
