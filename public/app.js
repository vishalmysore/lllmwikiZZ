/**
 * LLM WikiZZ — Frontend Application (Zero-Server Architecture)
 */

import { isPdf, extractPdfText } from './pdf-extract.js';

// --- Configuration & Providers ---
const WEBLLM_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',  name: 'Llama 3.2 1B  (~0.9 GB) — fastest' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',  name: 'Qwen 2.5 1.5B (~1.1 GB) — fast' },
  { id: 'gemma-2-2b-it-q4f16_1-MLC',           name: 'Gemma 2 2B   (~1.5 GB) — balanced' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',  name: 'Llama 3.2 3B  (~2.0 GB) — good' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',  name: 'Phi-3.5 Mini  (~2.2 GB) — best quality' },
];

const PROVIDERS = [
  {
    id: 'webllm',
    name: 'WebLLM (Local — No API Key)',
    keyPlaceholder: '',
    models: WEBLLM_MODELS,
    endpoint: null
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    keyPlaceholder: 'sk-ant-...',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (recommended)' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (fast)' }
    ],
    endpoint: 'https://api.anthropic.com/v1/messages'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyPlaceholder: 'sk-...',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (recommended)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (fast)' }
    ],
    endpoint: 'https://api.openai.com/v1/chat/completions'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    keyPlaceholder: 'AIza...',
    models: [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
    ],
    endpoint: 'https://generativelanguage.googleapis.com'
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    keyPlaceholder: 'nvapi-...',
    models: [
      { id: 'nvidia/nemotron-nano-12b-v2-vl', name: 'Nano 12B V2' },
      { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Llama 3.1 Nemotron 70B' }
    ],
    endpoint: 'https://integrate.api.nvidia.com/v1'
  }
];

// --- State ---
let currentDocumentText = null;
let wikizzEnabled = true;
let globalZeespec = null;

// WebLLM worker state
let webllmWorker   = null;
let webllmStatus   = 'idle';   // idle | loading | ready | error
let webllmModelId  = null;
let webllmGenCount = 0;
let webllmLoadResolve = null;
let webllmLoadReject  = null;
let webllmGenResolve  = null;
let webllmGenReject   = null;

// --- DOM references ---
const $ = (sel) => document.querySelector(sel);
const providerSelect    = $('#provider-select');
const modelSelect       = $('#model-select');
const apiKeyInput       = $('#api-key');
const toggleKeyVis      = $('#toggle-key-vis');
const uploadZone        = $('#upload-zone');
const fileInput         = $('#file-input');
const uploadSpinner     = $('#upload-spinner');
const uploadSuccess     = $('#upload-success');
const uploadFilename    = $('#upload-filename');
const uploadMeta        = $('#upload-meta');
const uploadPreview     = $('#upload-preview');
const previewToggle     = $('#preview-toggle');
const truncationWarning = $('#truncation-warning');
const changeFileBtn     = $('#change-file-btn');
const generateWikiBtn   = $('#generate-wiki-btn');
const wikizzToggle      = $('#wikizz-toggle');
const queryInput        = $('#query-input');
const runBtn            = $('#run-btn');
const setupSection      = $('#setup-section');
const resultsSection    = $('#results-section');
const plainAnswer       = $('#plain-answer');
const wikizzAnswer      = $('#wikizz-answer');
const plainTokens       = $('#plain-tokens');
const plainLatency      = $('#plain-latency');
const wikizzTokens      = $('#wikizz-tokens');
const wikizzLatency     = $('#wikizz-latency');
const verdictSummary    = $('#verdict-summary');
const verdictImprovements = $('#verdict-improvements');
const errorBanner       = $('#error-banner');
const errorText         = $('#error-text');
const runAgainBtn       = $('#run-again-btn');
const copyPlainBtn      = $('#copy-plain-btn');
const copyWikizzBtn     = $('#copy-wikizz-btn');
const proxyUrlInput     = $('#proxy-url');
const resetProxyBtn     = $('#reset-proxy-btn');
const testKeyBtn        = $('#test-key-btn');
const cloudApiSection   = $('#cloud-api-section');
const webllmSection     = $('#webllm-section');
const loadModelBtn      = $('#load-model-btn');
const webllmStatusEl    = $('#webllm-status');
const webllmProgressWrap = $('#webllm-progress-bar-wrap');
const webllmProgressBar  = $('#webllm-progress-bar');
const webllmProgressText = $('#webllm-progress-text');

const DEFAULT_PROXY = 'https://rough-tree-aee4.vishalmysore.workers.dev';

// --- Init ---
document.addEventListener('DOMContentLoaded', init);

function init() {
  loadProviders();
  bindEvents();

  const savedProxy = localStorage.getItem('quantum_ai_custom_proxy');
  proxyUrlInput.value = savedProxy || DEFAULT_PROXY;
}

function loadProviders() {
  providerSelect.innerHTML = PROVIDERS.map(p =>
    `<option value="${p.id}">${p.name}</option>`
  ).join('');
  updateModels();
  updateProviderUI();
}

function updateModels() {
  const provider = PROVIDERS.find(p => p.id === providerSelect.value);
  if (!provider) return;
  modelSelect.innerHTML = provider.models.map(m =>
    `<option value="${m.id}">${m.name}</option>`
  ).join('');
}

function updateProviderUI() {
  const isWebLLM = providerSelect.value === 'webllm';
  cloudApiSection.style.display = isWebLLM ? 'none' : '';
  webllmSection.style.display   = isWebLLM ? '' : 'none';

  if (!isWebLLM) {
    const provider = PROVIDERS.find(p => p.id === providerSelect.value);
    if (provider) apiKeyInput.placeholder = provider.keyPlaceholder;
  }
}

// --- Event Bindings ---
function bindEvents() {
  providerSelect.addEventListener('change', () => {
    updateModels();
    updateProviderUI();
  });

  toggleKeyVis.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVis.textContent = isPassword ? '🙈' : '👁';
  });

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFileUpload(fileInput.files[0]);
  });

  previewToggle.addEventListener('click', () => {
    const visible = uploadPreview.classList.toggle('visible');
    previewToggle.textContent = visible ? 'Hide preview ▴' : 'Show preview ▾';
  });

  changeFileBtn.addEventListener('click', () => {
    currentDocumentText = null;
    globalZeespec = null;
    $('#generated-zeespec').style.display = 'none';
    uploadSuccess.classList.remove('visible');
    uploadZone.style.display = '';
    fileInput.value = '';
  });

  generateWikiBtn.addEventListener('click', generateWiki);

  wikizzToggle.addEventListener('click', toggleWikizz);
  wikizzToggle.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleWikizz(); }
  });

  runBtn.addEventListener('click', runQuery);

  runAgainBtn.addEventListener('click', () => {
    resultsSection.classList.remove('visible');
    setupSection.style.display = '';
    resetResults();
  });

  copyPlainBtn.addEventListener('click', () => copyToClipboard(plainAnswer.textContent, copyPlainBtn));
  copyWikizzBtn.addEventListener('click', () => copyToClipboard(wikizzAnswer.textContent, copyWikizzBtn));
  testKeyBtn.addEventListener('click', testConnection);

  proxyUrlInput.addEventListener('change', () => {
    let val = proxyUrlInput.value.trim();
    if (val && !val.startsWith('http')) val = 'https://' + val;
    proxyUrlInput.value = val;
    localStorage.setItem('quantum_ai_custom_proxy', val);
  });

  resetProxyBtn.addEventListener('click', () => {
    proxyUrlInput.value = DEFAULT_PROXY;
    localStorage.setItem('quantum_ai_custom_proxy', DEFAULT_PROXY);
  });

  loadModelBtn.addEventListener('click', loadWebLLMModel);
}

function toggleWikizz() {
  wikizzEnabled = !wikizzEnabled;
  wikizzToggle.classList.toggle('active', wikizzEnabled);
  wikizzToggle.setAttribute('aria-checked', wikizzEnabled);
}

// --- File Upload ---
async function handleFileUpload(file) {
  dismissError();

  const isText = file.type === 'text/plain' || file.type === 'text/markdown' || file.name.endsWith('.md') || file.name.endsWith('.txt');
  if (!isText && !isPdf(file)) { showError('Only PDF, TXT and MD files are supported.'); return; }
  if (file.size > 10 * 1024 * 1024) { showError('File must be under 10MB.'); return; }

  uploadZone.style.display = 'none';
  uploadSpinner.classList.add('visible');
  const spinnerText = uploadSpinner.querySelector('.upload-spinner-text');

  try {
    let text;
    if (isPdf(file)) {
      if (spinnerText) spinnerText.textContent = 'Extracting text from PDF...';
      const buf = await file.arrayBuffer();
      text = await extractPdfText(buf, { onProgress: (p, t) => {
        if (spinnerText) spinnerText.textContent = `Extracting PDF... page ${p}/${t}`;
      }});
      if (!text || text.length < 20) {
        throw new Error('Could not extract text — this PDF may be scanned/image-only.');
      }
    } else {
      text = await file.text();
    }

    let truncated = false;
    if (text.length > 30000) { text = text.substring(0, 30000); truncated = true; }

    currentDocumentText = text;
    uploadSpinner.classList.remove('visible');
    if (spinnerText) spinnerText.textContent = 'Extracting text...';
    uploadFilename.textContent = `📎 ${file.name}`;
    uploadMeta.textContent = `${text.length.toLocaleString()} characters extracted`;
    uploadPreview.textContent = text.substring(0, 500) + '...';
    uploadSuccess.classList.add('visible');
    truncationWarning.classList.toggle('visible', truncated);
  } catch (err) {
    uploadSpinner.classList.remove('visible');
    if (spinnerText) spinnerText.textContent = 'Extracting text...';
    uploadZone.style.display = '';
    fileInput.value = '';
    showError('Error reading file: ' + (err.message || err));
  }
}

// ==========================================
// WebLLM — Local in-browser inference
// ==========================================

function ensureWebLLMWorker() {
  if (webllmWorker) return;
  webllmWorker = new Worker(new URL('./webllm-worker.js', import.meta.url), { type: 'module' });
  webllmWorker.onmessage = handleWorkerMessage;
  webllmWorker.onerror = (e) => {
    webllmStatus = 'error';
    const msg = e.message ?? 'Worker crashed';
    setWebLLMStatus('error', msg);
    if (webllmLoadReject) { webllmLoadReject(new Error(msg)); webllmLoadResolve = webllmLoadReject = null; }
    if (webllmGenReject)  { webllmGenReject(new Error(msg));  webllmGenResolve  = webllmGenReject  = null; }
  };
}

function handleWorkerMessage(e) {
  const msg = e.data;
  switch (msg.status) {
    case 'device_detected':
      setWebLLMStatus('loading', 'WebGPU detected, starting download...');
      break;
    case 'phase':
      setWebLLMStatus('loading', msg.note || msg.phase);
      break;
    case 'downloading':
      setWebLLMStatus('loading', msg.file, msg.progress);
      break;
    case 'ready':
      webllmStatus  = 'ready';
      webllmModelId = msg.modelId;
      setWebLLMStatus('ready', `Model ready: ${msg.modelId.split('-').slice(0,3).join(' ')}`);
      loadModelBtn.textContent = '✅ Model Loaded';
      loadModelBtn.disabled = false;
      webllmProgressWrap.style.display = 'none';
      if (webllmLoadResolve) { webllmLoadResolve(msg.modelId); webllmLoadResolve = webllmLoadReject = null; }
      break;
    case 'success':
      if (webllmGenResolve) {
        webllmGenResolve({ text: msg.generatedText, latencyMs: Math.round(msg.elapsedMs), tokensPerSec: msg.tokensPerSec });
        webllmGenResolve = webllmGenReject = null;
      }
      break;
    case 'error':
      webllmStatus = 'error';
      setWebLLMStatus('error', msg.error);
      loadModelBtn.textContent = '⬇ Load Model';
      loadModelBtn.disabled = false;
      webllmProgressWrap.style.display = 'none';
      if (webllmLoadReject) { webllmLoadReject(new Error(msg.error)); webllmLoadResolve = webllmLoadReject = null; }
      if (webllmGenReject)  { webllmGenReject(new Error(msg.error));  webllmGenResolve  = webllmGenReject  = null; }
      break;
  }
}

function setWebLLMStatus(type, text, progress) {
  webllmStatusEl.textContent = text;
  webllmStatusEl.style.color = type === 'error' ? '#f87171' : type === 'ready' ? '#4ade80' : '#a5b4fc';
  if (progress !== undefined) {
    webllmProgressWrap.style.display = '';
    webllmProgressBar.style.width = progress + '%';
    webllmProgressText.textContent = text;
    webllmStatusEl.textContent = `${progress}%`;
  }
}

async function loadWebLLMModel() {
  dismissError();
  const modelId = modelSelect.value;
  if (!modelId) { showError('Select a model first.'); return; }

  ensureWebLLMWorker();
  webllmStatus = 'loading';
  loadModelBtn.textContent = 'Loading...';
  loadModelBtn.disabled = true;
  webllmProgressWrap.style.display = '';
  webllmProgressBar.style.width = '0%';
  setWebLLMStatus('loading', 'Initialising...');

  webllmGenCount++;
  return new Promise((resolve, reject) => {
    webllmLoadResolve = resolve;
    webllmLoadReject  = reject;
    webllmWorker.postMessage({ action: 'load', modelId, gen: webllmGenCount });
  }).catch((err) => {
    showError(`WebLLM error: ${err.message}`);
  });
}

function callWebLLM(system, userMessage) {
  if (webllmStatus !== 'ready' || !webllmWorker) {
    throw new Error('WebLLM model not loaded. Click "Load Model" first.');
  }
  webllmGenCount++;
  return new Promise((resolve, reject) => {
    webllmGenResolve = ({ text, latencyMs }) => resolve({ text, tokensUsed: 0, latencyMs });
    webllmGenReject  = reject;
    webllmWorker.postMessage({
      action: 'generate',
      systemPrompt: system,
      messages: [{ role: 'user', content: userMessage }],
      gen: webllmGenCount,
    });
  });
}

// --- Generate Wiki ---
async function generateWiki() {
  dismissError();
  const isWebLLM = providerSelect.value === 'webllm';
  if (!isWebLLM && !apiKeyInput.value.trim()) return showError('Please enter your API key.');
  if (isWebLLM && webllmStatus !== 'ready') return showError('Please load a WebLLM model first.');
  if (!currentDocumentText) return showError('Please upload a document first.');

  const apiKey     = apiKeyInput.value.trim();
  const providerDef = PROVIDERS.find(p => p.id === providerSelect.value);
  const model      = modelSelect.value;

  generateWikiBtn.disabled = true;
  generateWikiBtn.textContent = 'Generating...';

  const system = `You are a helpful analyst extracting the 5W1H (Who, What, When, Where, Why, How) context from a document to build a proper Wiki framing context.
Look at the document snippet, and deduce reasonable, concise values for the 5W1H variables. If you don't know a specific variable, infer the most likely scenario or write "Unspecified".
Return ONLY a valid JSON object with the exact keys: "who", "what", "when", "where", "why", "how". Do not include any other text or markdown formatting outside the JSON.`;

  $('#generated-zeespec').textContent = '🤖 Generating 5W1H Context from the LLM...';
  $('#generated-zeespec').style.display = 'block';

  try {
    const snippet = `Document snippet (for context): ${currentDocumentText.substring(0, 3000)}`;
    const result  = isWebLLM
      ? await callWebLLM(system, snippet)
      : await callCloudLLM(providerDef, apiKey, model, system, snippet, 400);

    let jsonStr = result.text.trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    globalZeespec = JSON.parse(jsonStr);
    $('#generated-zeespec').textContent = JSON.stringify(globalZeespec, null, 2);
  } catch (err) {
    showError('Failed to parse the LLM-generated 5W1H context. Please try again. ' + err.message);
    $('#generated-zeespec').style.display = 'none';
  } finally {
    generateWikiBtn.disabled = false;
    generateWikiBtn.textContent = '✨ Generate Wiki Context';
  }
}

// --- Run Query ---
async function runQuery() {
  dismissError();

  const isWebLLM = providerSelect.value === 'webllm';
  if (!isWebLLM && !apiKeyInput.value.trim()) return showError('Please enter your API key.');
  if (isWebLLM && webllmStatus !== 'ready') return showError('Please load a WebLLM model first (click "Load Model").');
  if (!currentDocumentText) return showError('Please upload a document first.');
  if (!queryInput.value.trim()) return showError('Please enter a question.');
  if (wikizzEnabled && !globalZeespec) return showError('Please click "Generate Wiki Context" first, or disable Wiki comparison.');

  const apiKey     = apiKeyInput.value.trim();
  const providerDef = PROVIDERS.find(p => p.id === providerSelect.value);
  const model      = modelSelect.value;
  const query      = queryInput.value.trim();

  setupSection.style.display = 'none';
  resultsSection.classList.add('visible');
  resetResults();

  runBtn.classList.add('btn-loading');
  runBtn.disabled = true;

  $('#result-wikizz').style.display = wikizzEnabled ? '' : 'none';
  document.querySelector('.results-grid').style.gridTemplateColumns = wikizzEnabled ? '1fr 1fr' : '1fr';

  const invoke = (system, userMessage, maxTokens) =>
    isWebLLM
      ? callWebLLM(system, userMessage)
      : callCloudLLM(providerDef, apiKey, model, system, userMessage, maxTokens);

  try {
    const plainPrompt = buildPlainPrompt(currentDocumentText, query);
    const plainResult = await invoke(plainPrompt.system, plainPrompt.userMessage, 2048);
    plainAnswer.textContent = plainResult.text;
    plainTokens.textContent = plainResult.tokensUsed ? plainResult.tokensUsed.toLocaleString() : '—';
    plainLatency.textContent = `${(plainResult.latencyMs / 1000).toFixed(1)}s`;

    if (wikizzEnabled) {
      const wikizzPrompt = buildWikizzPrompt(currentDocumentText, query, globalZeespec);
      const wikizzResult = await invoke(wikizzPrompt.system, wikizzPrompt.userMessage, 2048);
      wikizzAnswer.textContent = wikizzResult.text;
      wikizzTokens.textContent = wikizzResult.tokensUsed ? wikizzResult.tokensUsed.toLocaleString() : '—';
      wikizzLatency.textContent = `${(wikizzResult.latencyMs / 1000).toFixed(1)}s`;

      const verdictPrompt = buildVerdictPrompt(query, plainResult.text, wikizzResult.text);
      const verdictResult = await invoke(verdictPrompt.system, verdictPrompt.userMessage, 512);

      let parsedVerdict;
      try {
        let jsonStr = verdictResult.text.trim();
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        parsedVerdict = JSON.parse(jsonStr);
      } catch (e) {
        parsedVerdict = { summary: verdictResult.text, improvements: [] };
      }

      verdictSummary.textContent = parsedVerdict.summary || 'No summary generated.';
      verdictImprovements.innerHTML = (parsedVerdict.improvements || []).map(imp => `<li>${escapeHtml(imp)}</li>`).join('');
      $('#verdict-card').style.display = '';
    } else {
      $('#verdict-card').style.display = 'none';
    }

  } catch (err) {
    showError(err.message);
    resultsSection.classList.remove('visible');
    setupSection.style.display = '';
  } finally {
    runBtn.classList.remove('btn-loading');
    runBtn.disabled = false;
  }
}

function resetResults() {
  const skeletonHTML = `
    <div class="skeleton skeleton-line" style="width:95%"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line"></div>
  `;
  plainAnswer.innerHTML = skeletonHTML;
  wikizzAnswer.innerHTML = skeletonHTML;
  plainTokens.textContent = '—';
  plainLatency.textContent = '—';
  wikizzTokens.textContent = '—';
  wikizzLatency.textContent = '—';
  verdictSummary.innerHTML = `<span class="skeleton skeleton-line" style="width:90%"></span>`;
  verdictImprovements.innerHTML = '';
}

function showError(message) {
  errorText.textContent = message;
  errorBanner.classList.add('visible');
  errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function dismissError() {
  errorBanner.classList.remove('visible');
}

// expose for inline onclick in HTML
window.dismissError = dismissError;

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = originalText; }, 1500);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==========================================
// CLOUD LLM CLIENT LOGIC
// ==========================================

function getProxyHeaders(targetUrl) {
  return { 'x-target-url': targetUrl };
}

async function testConnection() {
  dismissError();
  if (providerSelect.value === 'webllm') {
    showError('WebLLM runs locally — no connection test needed. Just click "Load Model".');
    return;
  }
  const apiKey = apiKeyInput.value.trim();
  const providerDef = PROVIDERS.find(p => p.id === providerSelect.value);
  const model = modelSelect.value;
  if (!apiKey) return showError('Please enter an API key to test.');

  testKeyBtn.textContent = '⏳...';
  testKeyBtn.disabled = true;
  try {
    const result = await callCloudLLM(providerDef, apiKey, model, 'You are a tester.', 'Say OK', 10);
    if (result.text.toLowerCase().includes('ok')) {
      testKeyBtn.textContent = '✅';
      setTimeout(() => { testKeyBtn.textContent = '🧪 Test'; testKeyBtn.disabled = false; }, 2000);
    } else {
      throw new Error('Unexpected response from LLM');
    }
  } catch (err) {
    showError(`Connection failed: ${err.message}`);
    testKeyBtn.textContent = '❌';
    setTimeout(() => { testKeyBtn.textContent = '🧪 Test'; testKeyBtn.disabled = false; }, 3000);
  }
}

async function callCloudLLM(providerDef, apiKey, model, system, userMessage, maxTokens = 2048) {
  const start = Date.now();
  let text = '';
  let tokensUsed = 0;

  let apiEndpoint = providerDef.endpoint;
  if (providerDef.id === 'nvidia' && !apiEndpoint.endsWith('/chat/completions')) {
    apiEndpoint += '/chat/completions';
  }

  const targetUrl = providerDef.id === 'gemini'
    ? `${apiEndpoint}/v1beta/models/${model}:generateContent?key=${apiKey}`
    : apiEndpoint;

  const fetchUrl = proxyUrlInput.value.trim() || DEFAULT_PROXY;
  const proxyHeaders = getProxyHeaders(targetUrl);

  let headers = { 'Content-Type': 'application/json', ...proxyHeaders };
  let body = {};

  if (providerDef.id === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] };
  } else if (providerDef.id === 'openai' || providerDef.id === 'nvidia') {
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = { model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: userMessage }] };
  } else if (providerDef.id === 'gemini') {
    body = { contents: [{ parts: [{ text: system + '\n\n' + userMessage }] }], generationConfig: { maxOutputTokens: maxTokens } };
  }

  const res = await fetch(fetchUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    throw new Error(`API error (${res.status}): ${msg}`);
  }

  if (providerDef.id === 'anthropic') {
    text = data.content?.[0]?.text || '';
    tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
  } else if (providerDef.id === 'openai' || providerDef.id === 'nvidia') {
    text = data.choices?.[0]?.message?.content || '';
    tokensUsed = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);
  } else if (providerDef.id === 'gemini') {
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    tokensUsed = (data.usageMetadata?.promptTokenCount || 0) + (data.usageMetadata?.candidatesTokenCount || 0);
  }

  return { text, tokensUsed, latencyMs: Date.now() - start };
}

// ==========================================
// PROMPT BUILDER LOGIC
// ==========================================

const SYSTEM_BASE = 'You are a helpful assistant. Answer the user\'s question based only on the provided document.';

function buildPlainPrompt(documentText, query) {
  return {
    system: SYSTEM_BASE,
    userMessage: `Document:\n${documentText}\n\nQuestion: ${query}`
  };
}

function buildWikizzPrompt(documentText, query, zeespec) {
  const system = `${SYSTEM_BASE}\n
Context about this request:
- Who is asking / who this is for: ${zeespec.who}
- What they need to accomplish: ${zeespec.what}
- When / timing context: ${zeespec.when}
- Where / situational context: ${zeespec.where}
- Why this matters: ${zeespec.why}
- How the answer should be structured: ${zeespec.how}\n
Use this context to tailor your answer specifically to this person's situation and needs.`;

  return { system, userMessage: `Document:\n${documentText}\n\nQuestion: ${query}` };
}

function buildVerdictPrompt(query, plainAnswer, wikizzAnswer) {
  const system = `You are an expert evaluator. Compare two LLM answers to the same question — one generated without context framing ("Plain") and one with structured 5W1H context ("WikiZZ"). Explain specifically what changed and whether the WikiZZ framing improved the answer.\n
Respond in this JSON format only:
{
  "summary": "A 2-3 sentence explanation...",
  "improvements": ["improvement 1", "improvement 2"]
}
Return valid JSON only, no markdown fencing.`;

  const userMessage = `Original question: ${query}\n
--- Plain Answer (no framing) ---
${plainAnswer}\n
--- WikiZZ Answer (5W1H framing) ---
${wikizzAnswer}`;

  return { system, userMessage };
}
