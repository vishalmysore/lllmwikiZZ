/**
 * Build prompts for Plain and WikiZZ (5W1H) modes.
 */

const SYSTEM_BASE = 'You are a helpful assistant. Answer the user\'s question based only on the provided document.';

/**
 * Build the plain (no-framing) prompt pair.
 * @param {string} documentText
 * @param {string} query
 * @returns {{ system: string, userMessage: string }}
 */
function buildPlainPrompt(documentText, query) {
  return {
    system: SYSTEM_BASE,
    userMessage: `Document:\n${documentText}\n\nQuestion: ${query}`
  };
}

/**
 * Build the WikiZZ (5W1H framing) prompt pair.
 * @param {string} documentText
 * @param {string} query
 * @param {Object} zeespec - { who, what, when, where, why, how }
 * @returns {{ system: string, userMessage: string }}
 */
function buildWikizzPrompt(documentText, query, zeespec) {
  const system = `${SYSTEM_BASE}

Context about this request:
- Who is asking / who this is for: ${zeespec.who}
- What they need to accomplish: ${zeespec.what}
- When / timing context: ${zeespec.when}
- Where / situational context: ${zeespec.where}
- Why this matters: ${zeespec.why}
- How the answer should be structured: ${zeespec.how}

Use this context to tailor your answer specifically to this person's situation and needs.`;

  return {
    system,
    userMessage: `Document:\n${documentText}\n\nQuestion: ${query}`
  };
}

/**
 * Build the verdict prompt that compares plain and WikiZZ answers.
 * @param {string} query
 * @param {string} plainAnswer
 * @param {string} wikizzAnswer
 * @returns {{ system: string, userMessage: string }}
 */
function buildVerdictPrompt(query, plainAnswer, wikizzAnswer) {
  const system = `You are an expert evaluator. Compare two LLM answers to the same question — one generated without context framing ("Plain") and one with structured 5W1H context ("WikiZZ"). Explain specifically what changed and whether the WikiZZ framing improved the answer.

Respond in this JSON format only:
{
  "summary": "A 2-3 sentence explanation of the key differences and whether WikiZZ improved the answer.",
  "improvements": ["improvement 1", "improvement 2", "improvement 3"]
}

If the WikiZZ answer was NOT better, say so honestly. Return valid JSON only, no markdown fencing.`;

  const userMessage = `Original question: ${query}

--- Plain Answer (no framing) ---
${plainAnswer}

--- WikiZZ Answer (5W1H framing) ---
${wikizzAnswer}`;

  return { system, userMessage };
}

module.exports = { buildPlainPrompt, buildWikizzPrompt, buildVerdictPrompt };
