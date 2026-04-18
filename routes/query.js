const express = require('express');
const { callLLM } = require('../services/llmClient');
const { buildPlainPrompt, buildWikizzPrompt } = require('../services/promptBuilder');
const { generateVerdict } = require('../services/comparator');

const router = express.Router();

/**
 * POST /api/query
 * Run both plain and WikiZZ queries against a stored document.
 */
router.post('/', async (req, res) => {
  const documentStore = req.app.locals.documentStore;
  const proxyUrl = req.app.locals.proxyUrl || undefined;

  try {
    const { documentId, apiKey, provider, model, query, zeespec } = req.body;

    // Validate required fields
    if (!documentId || !apiKey || !provider || !model || !query) {
      return res.status(400).json({ error: 'Missing required fields: documentId, apiKey, provider, model, query.' });
    }

    // Look up document
    const doc = documentStore.get(documentId);
    if (!doc) {
      return res.status(404).json({ error: 'Session expired. Please re-upload your document.' });
    }

    // Build prompts
    const plainPrompt = buildPlainPrompt(doc.text, query);

    // Determine if WikiZZ mode is active
    const hasZeespec = zeespec && zeespec.who && zeespec.what;

    if (!hasZeespec) {
      // Plain-only mode
      const plainResult = await callLLM({
        provider,
        apiKey,
        model,
        system: plainPrompt.system,
        userMessage: plainPrompt.userMessage,
        proxyUrl
      });

      return res.json({
        plain: {
          answer: plainResult.text,
          tokensUsed: plainResult.tokensUsed,
          latencyMs: plainResult.latencyMs
        },
        wikizz: null,
        verdict: null
      });
    }

    // WikiZZ mode — run both in parallel
    const wikizzPrompt = buildWikizzPrompt(doc.text, query, zeespec);

    const [plainResult, wikizzResult] = await Promise.all([
      callLLM({
        provider,
        apiKey,
        model,
        system: plainPrompt.system,
        userMessage: plainPrompt.userMessage,
        proxyUrl
      }),
      callLLM({
        provider,
        apiKey,
        model,
        system: wikizzPrompt.system,
        userMessage: wikizzPrompt.userMessage,
        proxyUrl
      })
    ]);

    // Generate verdict
    const verdict = await generateVerdict({
      provider,
      apiKey,
      model,
      query,
      plainAnswer: plainResult.text,
      wikizzAnswer: wikizzResult.text,
      proxyUrl
    });

    res.json({
      plain: {
        answer: plainResult.text,
        tokensUsed: plainResult.tokensUsed,
        latencyMs: plainResult.latencyMs
      },
      wikizz: {
        answer: wikizzResult.text,
        tokensUsed: wikizzResult.tokensUsed,
        latencyMs: wikizzResult.latencyMs
      },
      verdict
    });

  } catch (err) {
    const message = err.message || 'An unexpected error occurred.';

    // Map known error patterns to appropriate status codes
    const status = message.includes('API key rejected') ? 401
      : message.includes('took too long') ? 504
      : message.includes('Unsupported provider') ? 400
      : 500;

    res.status(status).json({ error: message });
  }
});

module.exports = router;
