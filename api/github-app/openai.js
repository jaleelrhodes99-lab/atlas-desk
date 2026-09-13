const OpenAI = require("openai");

function getOutputText(response) {
  if (response.output_text) return response.output_text.trim();
  if (!response.output || !Array.isArray(response.output)) return "";

  const texts = [];
  for (const item of response.output) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "output_text" && content.text) {
        texts.push(content.text);
      }
    }
  }
  return texts.join("\n").trim();
}

function createOpenAIResponder(config) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";

  if (!apiKey) {
    return {
      async respond() {
        return "Thanks for the report. We will triage this shortly and follow up with next steps.";
      },
    };
  }

  const client = new OpenAI({ apiKey });
  const timeoutMs = Number(config.openAITimeoutMs || 10000);

  return {
    async respond(prompt) {
      const response = await client.responses.create(
        {
          model,
          input: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          max_output_tokens: 220,
        },
        { timeout: timeoutMs }
      );

      const output = getOutputText(response);
      return output || "Thanks for the context. We will continue triage and report next steps.";
    },
  };
}

module.exports = {
  createOpenAIResponder,
};
