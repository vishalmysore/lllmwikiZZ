/**
 * Unified LLM client that normalises requests across Anthropic, OpenAI, Google Gemini, and NVIDIA NIM.
 */

/**
 * Resolve the fetch URL and extra headers needed for proxy routing.
 * When proxyUrl is provided, requests are forwarded through it with the
 * real target set in the x-target-url header (same pattern as QuantumMeetsAI
 * cloudflare-worker / Vite dev-server proxy).
 *
 * @param {string} targetUrl - The real API endpoint
 * @param {string} [proxyUrl] - Optional proxy URL; when set, traffic is routed through it
 * @returns {{ fetchUrl: string, routingHeaders: Object }}
 */
function getRoutingConfig(targetUrl, proxyUrl) {
  if (!proxyUrl) {
    return { fetchUrl: targetUrl, routingHeaders: {} };
  }
  return {
    fetchUrl: proxyUrl,
    routingHeaders: { 'x-target-url': targetUrl }
  };
}

/**
 * Call an LLM provider with a system prompt and user message.
 * @param {Object} opts
 * @param {string} opts.provider - "anthropic" | "openai" | "gemini" | "nvidia"
 * @param {string} opts.apiKey - User's API key
 * @param {string} opts.model - Model identifier
 * @param {string} opts.system - System prompt
 * @param {string} opts.userMessage - User message
 * @param {number} [opts.maxTokens=2048] - Max tokens to generate
 * @param {string} [opts.proxyUrl] - Optional proxy URL for CORS-safe routing
 * @returns {Promise<{text: string, tokensUsed: number, latencyMs: number}>}
 */
async function callLLM({ provider, apiKey, model, system, userMessage, maxTokens = 2048, proxyUrl }) {
  const start = Date.now();

  let text = '';
  let tokensUsed = 0;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    switch (provider) {
      case 'anthropic':
        ({ text, tokensUsed } = await callAnthropic({ apiKey, model, system, userMessage, maxTokens, signal: controller.signal, proxyUrl }));
        break;
      case 'openai':
        ({ text, tokensUsed } = await callOpenAI({ apiKey, model, system, userMessage, maxTokens, signal: controller.signal, proxyUrl }));
        break;
      case 'gemini':
        ({ text, tokensUsed } = await callGemini({ apiKey, model, system, userMessage, maxTokens, signal: controller.signal, proxyUrl }));
        break;
      case 'nvidia':
        ({ text, tokensUsed } = await callNvidia({ apiKey, model, system, userMessage, maxTokens, signal: controller.signal, proxyUrl }));
        break;
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The LLM took too long to respond. Try a shorter document or simpler query.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Date.now() - start;
  return { text, tokensUsed, latencyMs };
}

// --- Anthropic ---
async function callAnthropic({ apiKey, model, system, userMessage, maxTokens, signal, proxyUrl }) {
  const targetUrl = 'https://api.anthropic.com/v1/messages';
  const { fetchUrl, routingHeaders } = getRoutingConfig(targetUrl, proxyUrl);

  const res = await fetch(fetchUrl, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...routingHeaders
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    if (res.status === 401) throw new Error('API key rejected by Anthropic. Please check your key.');
    throw new Error(`Anthropic error (${res.status}): ${msg}`);
  }

  return {
    text: data.content?.[0]?.text || '',
    tokensUsed: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
  };
}

// --- OpenAI ---
async function callOpenAI({ apiKey, model, system, userMessage, maxTokens, signal, proxyUrl }) {
  const targetUrl = 'https://api.openai.com/v1/chat/completions';
  const { fetchUrl, routingHeaders } = getRoutingConfig(targetUrl, proxyUrl);

  const res = await fetch(fetchUrl, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...routingHeaders
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage }
      ]
    })
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    if (res.status === 401) throw new Error('API key rejected by OpenAI. Please check your key.');
    throw new Error(`OpenAI error (${res.status}): ${msg}`);
  }

  return {
    text: data.choices?.[0]?.message?.content || '',
    tokensUsed: (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0)
  };
}

// --- Google Gemini ---
async function callGemini({ apiKey, model, system, userMessage, maxTokens, signal, proxyUrl }) {
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const { fetchUrl, routingHeaders } = getRoutingConfig(targetUrl, proxyUrl);

  const res = await fetch(fetchUrl, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...routingHeaders
    },
    body: JSON.stringify({
      contents: [
        { parts: [{ text: system + '\n\n' + userMessage }] }
      ],
      generationConfig: {
        maxOutputTokens: maxTokens
      }
    })
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    if (res.status === 400 && msg.includes('API key')) throw new Error('API key rejected by Google Gemini. Please check your key.');
    if (res.status === 403) throw new Error('API key rejected by Google Gemini. Please check your key.');
    throw new Error(`Gemini error (${res.status}): ${msg}`);
  }

  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || '';
  const tokensUsed = (data.usageMetadata?.promptTokenCount || 0) + (data.usageMetadata?.candidatesTokenCount || 0);

  return { text, tokensUsed };
}

// --- NVIDIA NIM (OpenAI-compatible) ---
async function callNvidia({ apiKey, model, system, userMessage, maxTokens, signal, proxyUrl }) {
  const targetUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
  const { fetchUrl, routingHeaders } = getRoutingConfig(targetUrl, proxyUrl);

  const res = await fetch(fetchUrl, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...routingHeaders
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2
    })
  });

  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    if (res.status === 401 || res.status === 403) throw new Error('API key rejected by NVIDIA NIM. Please check your key.');
    throw new Error(`NVIDIA NIM error (${res.status}): ${msg}`);
  }

  return {
    text: data.choices?.[0]?.message?.content || '',
    tokensUsed: (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0)
  };
}

module.exports = { callLLM };
