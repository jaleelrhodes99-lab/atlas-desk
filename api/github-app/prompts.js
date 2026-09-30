const ATLAS_GUARDRAILS = [
  "Control and Security desks remain separated.",
  "Do not suggest auto-placement of trades; SEND ORDER stays denied.",
  "Do not claim guaranteed market outcomes.",
  "Keep responses concise and practical.",
];

function baseContext(issue) {
  return [
    `Issue title: ${issue.title || ""}`,
    `Issue body: ${issue.body || ""}`,
    `Issue number: #${issue.number}`,
  ].join("\n");
}

function buildIssueReplyPrompt(issue) {
  return {
    system:
      "You are a repository maintainer assistant. Respond in 2-4 short sentences. " +
      ATLAS_GUARDRAILS.join(" "),
    user:
      `${baseContext(issue)}\n\nCreate a short maintainer reply that acknowledges the report and asks for missing details only when needed.`,
  };
}

function buildTriagePrompt(issue, commentBody) {
  return {
    system:
      "You triage GitHub issues. Return concise actionable triage guidance in 3 bullets max. " +
      ATLAS_GUARDRAILS.join(" "),
    user:
      `${baseContext(issue)}\n\nTrigger comment: ${commentBody}\n\nProvide triage outcome, next maintainer step, and whether more reproduction detail is needed.`,
  };
}

function buildSummaryPrompt(issue) {
  return {
    system:
      "Summarize issues for maintainers in 2-3 bullets, concise and factual. " +
      ATLAS_GUARDRAILS.join(" "),
    user: `${baseContext(issue)}\n\nProvide a short summary: problem, impact, and immediate next step.`,
  };
}

module.exports = {
  buildIssueReplyPrompt,
  buildTriagePrompt,
  buildSummaryPrompt,
};
