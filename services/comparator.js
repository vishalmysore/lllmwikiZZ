const { callLLM } = require('./llmClient');
const { buildVerdictPrompt } = require('./promptBuilder');

/**
 * Generate a verdict comparing the plain and WikiZZ answers.
 * @param {Object} opts
 * @param {string} opts.provider
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.query
 * @param {string} opts.plainAnswer
 * @param {string} opts.wikizzAnswer
 * @returns {Promise<{summary: string, improvements: string[]}>}
 */
async function generateVerdict({ provider, apiKey, model, query, plainAnswer, wikizzAnswer, proxyUrl }) {
  const { system, userMessage } = buildVerdictPrompt(query, plainAnswer, wikizzAnswer);

  const result = await callLLM({
    provider,
    apiKey,
    model,
    system,
    userMessage,
    maxTokens: 512,
    proxyUrl
  });

  // Parse the JSON response
  try {
    // Try to extract JSON from the response (in case the model wraps it)
    let jsonStr = result.text.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    const parsed = JSON.parse(jsonStr);
    return {
      summary: parsed.summary || 'No summary generated.',
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements : []
    };
  } catch {
    // If JSON parsing fails, return the raw text as summary
    return {
      summary: result.text,
      improvements: []
    };
  }
}

module.exports = { generateVerdict };
