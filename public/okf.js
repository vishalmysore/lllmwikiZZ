/**
 * OKF Wiki Builder — turns an uploaded document into an Open Knowledge Format bundle.
 *
 * Standalone module (does not touch app.js). Reuses style.css and webllm-worker.js.
 * OKF spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
 *
 * Two build modes:
 *   • Quick Build  — pure client-side, splits the doc by markdown headings. No API key needed.
 *   • Smart Build  — asks an LLM (cloud or WebLLM) to extract concepts as structured JSON.
 * Both feed the same deterministic OKF serializer, so the output is always spec-conformant.
 */

// ==========================================
// Providers (mirrors app.js so this page stands alone)
// ==========================================
const WEBLLM_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', name: 'Llama 3.2 1B  (~0.9 GB) — fastest' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B (~1.1 GB) — fast' },
  { id: 'gemma-2-2b-it-q4f16_1-MLC',          name: 'Gemma 2 2B   (~1.5 GB) — balanced' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 3B  (~2.0 GB) — good' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', name: 'Phi-3.5 Mini  (~2.2 GB) — best quality' },
];

const PROVIDERS = [
  { id: 'webllm',    name: 'WebLLM (Local — No API Key)', keyPlaceholder: '', models: WEBLLM_MODELS, endpoint: null },
  { id: 'anthropic', name: 'Anthropic', keyPlaceholder: 'sk-ant-...', models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet (recommended)' },
      { id: 'claude-3-haiku-20240307',    name: 'Claude 3 Haiku (fast)' },
    ], endpoint: 'https://api.anthropic.com/v1/messages' },
  { id: 'openai',    name: 'OpenAI', keyPlaceholder: 'sk-...', models: [
      { id: 'gpt-4o',      name: 'GPT-4o (recommended)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (fast)' },
    ], endpoint: 'https://api.openai.com/v1/chat/completions' },
  { id: 'gemini',    name: 'Google Gemini', keyPlaceholder: 'AIza...', models: [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-pro',   name: 'Gemini 1.5 Pro' },
    ], endpoint: 'https://generativelanguage.googleapis.com' },
  { id: 'nvidia',    name: 'NVIDIA NIM', keyPlaceholder: 'nvapi-...', models: [
      { id: 'nvidia/nemotron-nano-12b-v2-vl',        name: 'Nano 12B V2' },
      { id: 'meta/llama-3.1-70b-instruct',           name: 'Llama 3.1 70B Instruct' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Llama 3.1 Nemotron 70B' },
    ], endpoint: 'https://integrate.api.nvidia.com/v1' },
];

const DEFAULT_PROXY = 'https://rough-tree-aee4.vishalmysore.workers.dev';

// ==========================================
// State + DOM
// ==========================================
let currentDocumentText = null;
let currentFilename     = 'document.md';
let currentBundle       = null; // { files: [{path, content}], name }

// WebLLM worker plumbing (same protocol as app.js)
let webllmWorker = null, webllmStatus = 'idle', webllmGenCount = 0;
let webllmLoadResolve = null, webllmLoadReject = null, webllmGenResolve = null, webllmGenReject = null;

const $ = (s) => document.querySelector(s);
const providerSelect   = $('#provider-select');
const modelSelect      = $('#model-select');
const apiKeyInput      = $('#api-key');
const toggleKeyVis     = $('#toggle-key-vis');
const proxyUrlInput    = $('#proxy-url');
const resetProxyBtn    = $('#reset-proxy-btn');
const cloudApiSection  = $('#cloud-api-section');
const webllmSection    = $('#webllm-section');
const loadModelBtn     = $('#load-model-btn');
const webllmStatusEl   = $('#webllm-status');
const webllmProgressWrap = $('#webllm-progress-bar-wrap');
const webllmProgressBar  = $('#webllm-progress-bar');
const webllmProgressText = $('#webllm-progress-text');

const uploadZone     = $('#upload-zone');
const fileInput      = $('#file-input');
const uploadSuccess  = $('#upload-success');
const uploadFilename = $('#upload-filename');
const uploadMeta     = $('#upload-meta');
const changeFileBtn  = $('#change-file-btn');

const bundleNameInput = $('#bundle-name');
const quickBuildBtn   = $('#quick-build-btn');
const smartBuildBtn   = $('#smart-build-btn');
const downloadZipBtn  = $('#download-zip-btn');
const bundleOutput    = $('#bundle-output');
const bundleSection   = $('#bundle-section');

const errorBanner = $('#error-banner');
const errorText   = $('#error-text');

// ==========================================
// Init
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  providerSelect.innerHTML = PROVIDERS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  updateModels();
  updateProviderUI();
  proxyUrlInput.value = localStorage.getItem('quantum_ai_custom_proxy') || DEFAULT_PROXY;
  bindEvents();
});

function updateModels() {
  const p = PROVIDERS.find(x => x.id === providerSelect.value);
  if (p) modelSelect.innerHTML = p.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}
function updateProviderUI() {
  const isWebLLM = providerSelect.value === 'webllm';
  cloudApiSection.style.display = isWebLLM ? 'none' : '';
  webllmSection.style.display   = isWebLLM ? '' : 'none';
  if (!isWebLLM) {
    const p = PROVIDERS.find(x => x.id === providerSelect.value);
    if (p) apiKeyInput.placeholder = p.keyPlaceholder;
  }
}

function bindEvents() {
  providerSelect.addEventListener('change', () => { updateModels(); updateProviderUI(); });
  toggleKeyVis.addEventListener('click', () => {
    const pw = apiKeyInput.type === 'password';
    apiKeyInput.type = pw ? 'text' : 'password';
    toggleKeyVis.textContent = pw ? '🙈' : '👁';
  });
  proxyUrlInput.addEventListener('change', () => {
    let v = proxyUrlInput.value.trim();
    if (v && !v.startsWith('http')) v = 'https://' + v;
    proxyUrlInput.value = v;
    localStorage.setItem('quantum_ai_custom_proxy', v);
  });
  resetProxyBtn.addEventListener('click', () => {
    proxyUrlInput.value = DEFAULT_PROXY;
    localStorage.setItem('quantum_ai_custom_proxy', DEFAULT_PROXY);
  });
  loadModelBtn.addEventListener('click', loadWebLLMModel);

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault(); uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFileUpload(fileInput.files[0]); });
  changeFileBtn.addEventListener('click', () => {
    currentDocumentText = null;
    uploadSuccess.classList.remove('visible');
    uploadZone.style.display = '';
    fileInput.value = '';
  });

  quickBuildBtn.addEventListener('click', () => buildBundle('quick'));
  smartBuildBtn.addEventListener('click', () => buildBundle('smart'));
  downloadZipBtn.addEventListener('click', downloadBundleZip);
}

// ==========================================
// File upload
// ==========================================
function handleFileUpload(file) {
  dismissError();
  const isText = file.type === 'text/plain' || file.type === 'text/markdown' ||
                 file.name.endsWith('.md') || file.name.endsWith('.txt');
  if (!isText) return showError('Only TXT and MD files are supported.');
  if (file.size > 10 * 1024 * 1024) return showError('File must be under 10MB.');

  const reader = new FileReader();
  reader.onload = (e) => {
    let text = e.target.result;
    if (text.length > 30000) text = text.substring(0, 30000);
    currentDocumentText = text;
    currentFilename = file.name;
    uploadZone.style.display = 'none';
    uploadFilename.textContent = `📎 ${file.name}`;
    uploadMeta.textContent = `${text.length.toLocaleString()} characters`;
    uploadSuccess.classList.add('visible');
    if (!bundleNameInput.value.trim()) {
      bundleNameInput.value = slugify(file.name.replace(/\.(md|txt)$/i, '')) || 'knowledge-bundle';
    }
  };
  reader.onerror = () => showError('Error reading file.');
  reader.readAsText(file);
}

// ==========================================
// Build entry point
// ==========================================
async function buildBundle(mode) {
  dismissError();
  if (!currentDocumentText) return showError('Please upload a document first.');
  const bundleName = slugify(bundleNameInput.value.trim()) || 'knowledge-bundle';

  const btn = mode === 'quick' ? quickBuildBtn : smartBuildBtn;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Building…';

  try {
    let concepts, method;
    if (mode === 'quick') {
      concepts = conceptsFromHeadings(currentDocumentText);
      method = 'heading-split (client-side)';
    } else {
      concepts = await conceptsFromLLM(currentDocumentText);
      method = `LLM extraction (${providerSelect.value})`;
    }
    if (!concepts.length) throw new Error('No concepts could be extracted from this document.');

    const files = serializeOkfBundle(bundleName, concepts, method);
    currentBundle = { name: bundleName, files };
    renderBundle(files);
    bundleSection.style.display = '';
    bundleSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ==========================================
// Quick Build — split markdown by headings
// ==========================================
function conceptsFromHeadings(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { level: m[1].length, title: m[2].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      // Preamble before the first heading becomes an "Overview" concept.
      current = { level: 1, title: 'Overview', body: [line] };
    }
  }
  if (current) sections.push(current);

  // No headings at all → one concept for the whole doc.
  if (sections.length === 0) {
    sections.push({ level: 1, title: 'Document', body: text.split(/\r?\n/) });
  }

  const used = new Set();
  return sections
    .map(s => {
      const bodyText = s.body.join('\n').trim();
      if (!s.title && !bodyText) return null;
      let slug = slugify(s.title) || 'concept';
      let unique = slug, n = 2;
      while (used.has(unique)) unique = `${slug}-${n++}`;
      used.add(unique);
      return {
        slug: unique,
        type: s.level === 1 ? 'Document Section' : 'Subsection',
        title: s.title || 'Untitled',
        description: firstSentence(bodyText) || `Section "${s.title}" of ${currentFilename}.`,
        tags: keywordTags(s.title),
        body: bodyText || '_No content._',
      };
    })
    .filter(Boolean);
}

// ==========================================
// Smart Build — ask an LLM for concepts as JSON
// ==========================================
async function conceptsFromLLM(text) {
  const isWebLLM = providerSelect.value === 'webllm';
  const apiKey   = apiKeyInput.value.trim();
  if (!isWebLLM && !apiKey) throw new Error('Please enter your API key (or switch to WebLLM / Quick Build).');
  if (isWebLLM && webllmStatus !== 'ready') throw new Error('Please load a WebLLM model first.');

  const system = `You convert a document into an Open Knowledge Format (OKF) bundle.
Break the document into 3 to 8 distinct, self-contained CONCEPTS.
Return ONLY a JSON object, no markdown fencing, with this exact shape:
{
  "concepts": [
    {
      "slug": "kebab-case-filename-without-extension",
      "type": "Concept type, e.g. Playbook, Entity, Process, Reference",
      "title": "Human readable title",
      "description": "One sentence summary.",
      "tags": ["tag1", "tag2"],
      "body": "Markdown body. You MAY use headings: # Schema, # Examples, # Citations. To link another concept use /other-slug.md"
    }
  ]
}`;
  const user = `Document (${currentFilename}):\n${text.substring(0, 12000)}`;

  const providerDef = PROVIDERS.find(p => p.id === providerSelect.value);
  const raw = isWebLLM
    ? (await callWebLLM(system, user)).text
    : (await callCloudLLM(providerDef, apiKey, modelSelect.value, system, user, 2048)).text;

  let jsonStr = raw.trim();
  const match = jsonStr.match(/\{[\s\S]*\}/);
  if (match) jsonStr = match[0];
  let parsed;
  try { parsed = JSON.parse(jsonStr); }
  catch (e) { throw new Error('LLM did not return valid JSON. Try Quick Build, or a stronger model.'); }

  const concepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  const used = new Set();
  return concepts.map((c, i) => {
    let slug = slugify(c.slug || c.title || `concept-${i + 1}`) || `concept-${i + 1}`;
    let unique = slug, n = 2;
    while (used.has(unique)) unique = `${slug}-${n++}`;
    used.add(unique);
    return {
      slug: unique,
      type: (c.type && String(c.type).trim()) || 'Concept',
      title: c.title || slug,
      description: c.description || '',
      tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
      body: c.body || '_No content._',
    };
  });
}

// ==========================================
// OKF serializer — deterministic, spec-conformant
// Spec: every concept file has YAML frontmatter with a non-empty `type`.
//       index.md lists concepts; only the root index.md carries frontmatter (okf_version).
//       log.md records changes newest-first.
// ==========================================
function serializeOkfBundle(bundleName, concepts, method) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const files = [];

  // Concept files
  for (const c of concepts) {
    files.push({ path: `${c.slug}.md`, content: serializeConcept(c, now) });
  }

  // index.md (root — the one place frontmatter is allowed in an index)
  const indexBody =
`---
okf_version: "0.1"
title: ${yamlScalar(bundleName)}
timestamp: ${now}
---

# ${bundleName}

A knowledge bundle in **Open Knowledge Format (OKF)**, generated from \`${currentFilename}\`.

> OKF is a directory of markdown files with YAML frontmatter — readable by humans,
> parseable by agents, diffable in git. See the
> [OKF spec](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

## Concepts
${concepts.map(c => `* [${c.title}](/${c.slug}.md) — ${c.description || 'No description.'}`).join('\n')}
`;
  files.push({ path: 'index.md', content: indexBody });

  // log.md (newest date first)
  const logBody =
`# Log

## ${today}
**Creation** — Generated ${concepts.length} concept${concepts.length === 1 ? '' : 's'} from \`${currentFilename}\` via ${method}.
`;
  files.push({ path: 'log.md', content: logBody });

  // Keep index.md and log.md at the top of the listing.
  files.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  return files;
}

function serializeConcept(c, timestamp) {
  const fm = ['---'];
  fm.push(`type: ${yamlScalar(c.type || 'Concept')}`);      // required, non-empty
  if (c.title)       fm.push(`title: ${yamlScalar(c.title)}`);
  if (c.description) fm.push(`description: ${yamlScalar(c.description)}`);
  if (c.tags && c.tags.length) {
    fm.push('tags:');
    for (const t of c.tags) fm.push(`  - ${yamlScalar(t)}`);
  }
  fm.push(`timestamp: ${timestamp}`);
  fm.push('---');

  const heading = `# ${c.title || c.slug}`;
  return `${fm.join('\n')}\n\n${heading}\n\n${c.body.trim()}\n`;
}

function rank(path) {
  if (path === 'index.md') return 0;
  if (path === 'log.md')   return 1;
  return 2;
}

// ==========================================
// Render bundle to the page
// ==========================================
function renderBundle(files) {
  const tree = `<div class="okf-tree"><span class="okf-tree-root">${escapeHtml(currentBundle.name)}/</span>${
    files.map(f => `<div class="okf-tree-item">├── ${escapeHtml(f.path)}</div>`).join('')
  }</div>`;

  const cards = files.map((f, i) => `
    <div class="okf-file-card">
      <div class="okf-file-head">
        <span class="okf-file-name">📄 ${escapeHtml(f.path)}</span>
        <div class="okf-file-actions">
          <button class="copy-btn" data-copy="${i}" type="button">Copy</button>
          <button class="copy-btn" data-dl="${i}" type="button">Download</button>
        </div>
      </div>
      <pre class="okf-file-body">${escapeHtml(f.content)}</pre>
    </div>`).join('');

  bundleOutput.innerHTML = tree + cards;

  bundleOutput.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = files[+btn.dataset.copy];
      navigator.clipboard.writeText(f.content).then(() => {
        const t = btn.textContent; btn.textContent = 'Copied!';
        setTimeout(() => (btn.textContent = t), 1200);
      });
    });
  });
  bundleOutput.querySelectorAll('[data-dl]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = files[+btn.dataset.dl];
      downloadBlob(new Blob([f.content], { type: 'text/markdown' }), f.path.split('/').pop());
    });
  });
}

// ==========================================
// ZIP (store-only, pure JS) for the whole bundle
// ==========================================
function downloadBundleZip() {
  if (!currentBundle) return;
  const entries = currentBundle.files.map(f => ({
    name: `${currentBundle.name}/${f.path}`,
    data: new TextEncoder().encode(f.content),
  }));
  const blob = new Blob([makeZip(entries)], { type: 'application/zip' });
  downloadBlob(blob, `${currentBundle.name}.zip`);
}

function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const enc = (s) => new TextEncoder().encode(s);

  for (const e of entries) {
    const nameBytes = enc(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // local file header sig
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // method = store
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);        // compressed size
    lv.setUint32(22, size, true);        // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra len
    local.set(nameBytes, 30);
    chunks.push(local, e.data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);   // central dir sig
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);           // method
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);      // local header offset
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + e.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);     // end of central dir sig
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);        // central dir offset

  return new Blob([...chunks, ...central, end]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ==========================================
// Cloud LLM client (same proxy protocol as app.js)
// ==========================================
async function callCloudLLM(providerDef, apiKey, model, system, userMessage, maxTokens = 2048) {
  const start = Date.now();
  let apiEndpoint = providerDef.endpoint;
  if (providerDef.id === 'nvidia' && !apiEndpoint.endsWith('/chat/completions')) apiEndpoint += '/chat/completions';

  const targetUrl = providerDef.id === 'gemini'
    ? `${apiEndpoint}/v1beta/models/${model}:generateContent?key=${apiKey}`
    : apiEndpoint;

  const fetchUrl = proxyUrlInput.value.trim() || DEFAULT_PROXY;
  const headers = { 'Content-Type': 'application/json', 'x-target-url': targetUrl };
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
  if (!res.ok) throw new Error(`API error (${res.status}): ${data.error?.message || JSON.stringify(data)}`);

  let text = '';
  if (providerDef.id === 'anthropic') text = data.content?.[0]?.text || '';
  else if (providerDef.id === 'openai' || providerDef.id === 'nvidia') text = data.choices?.[0]?.message?.content || '';
  else if (providerDef.id === 'gemini') text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  return { text, latencyMs: Date.now() - start };
}

// ==========================================
// WebLLM worker wrapper (same protocol as app.js)
// ==========================================
function ensureWebLLMWorker() {
  if (webllmWorker) return;
  webllmWorker = new Worker(new URL('./webllm-worker.js', import.meta.url), { type: 'module' });
  webllmWorker.onmessage = handleWorkerMessage;
  webllmWorker.onerror = (e) => {
    webllmStatus = 'error';
    const msg = e.message ?? 'Worker crashed';
    setWebLLMStatus('error', msg);
    webllmLoadReject && (webllmLoadReject(new Error(msg)), webllmLoadResolve = webllmLoadReject = null);
    webllmGenReject  && (webllmGenReject(new Error(msg)),  webllmGenResolve  = webllmGenReject  = null);
  };
}
function handleWorkerMessage(e) {
  const msg = e.data;
  switch (msg.status) {
    case 'device_detected': setWebLLMStatus('loading', 'WebGPU detected, starting download...'); break;
    case 'phase':           setWebLLMStatus('loading', msg.note || msg.phase); break;
    case 'downloading':     setWebLLMStatus('loading', msg.file, msg.progress); break;
    case 'ready':
      webllmStatus = 'ready';
      setWebLLMStatus('ready', `Model ready: ${msg.modelId.split('-').slice(0, 3).join(' ')}`);
      loadModelBtn.textContent = '✅ Model Loaded';
      loadModelBtn.disabled = false;
      webllmProgressWrap.style.display = 'none';
      webllmLoadResolve && (webllmLoadResolve(msg.modelId), webllmLoadResolve = webllmLoadReject = null);
      break;
    case 'success':
      webllmGenResolve && (webllmGenResolve({ text: msg.generatedText, latencyMs: Math.round(msg.elapsedMs) }), webllmGenResolve = webllmGenReject = null);
      break;
    case 'error':
      webllmStatus = 'error';
      setWebLLMStatus('error', msg.error);
      loadModelBtn.textContent = '⬇ Load Model';
      loadModelBtn.disabled = false;
      webllmProgressWrap.style.display = 'none';
      webllmLoadReject && (webllmLoadReject(new Error(msg.error)), webllmLoadResolve = webllmLoadReject = null);
      webllmGenReject  && (webllmGenReject(new Error(msg.error)),  webllmGenResolve  = webllmGenReject  = null);
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
function loadWebLLMModel() {
  dismissError();
  const modelId = modelSelect.value;
  if (!modelId) return showError('Select a model first.');
  ensureWebLLMWorker();
  webllmStatus = 'loading';
  loadModelBtn.textContent = 'Loading...';
  loadModelBtn.disabled = true;
  webllmProgressWrap.style.display = '';
  webllmProgressBar.style.width = '0%';
  setWebLLMStatus('loading', 'Initialising...');
  webllmGenCount++;
  return new Promise((resolve, reject) => {
    webllmLoadResolve = resolve; webllmLoadReject = reject;
    webllmWorker.postMessage({ action: 'load', modelId, gen: webllmGenCount });
  }).catch(err => showError(`WebLLM error: ${err.message}`));
}
function callWebLLM(system, userMessage) {
  if (webllmStatus !== 'ready' || !webllmWorker) throw new Error('WebLLM model not loaded.');
  webllmGenCount++;
  return new Promise((resolve, reject) => {
    webllmGenResolve = resolve; webllmGenReject = reject;
    webllmWorker.postMessage({ action: 'generate', systemPrompt: system, messages: [{ role: 'user', content: userMessage }], gen: webllmGenCount });
  });
}

// ==========================================
// Utilities
// ==========================================
function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
function firstSentence(text) {
  const clean = text.replace(/^#+\s.*$/gm, '').replace(/\s+/g, ' ').trim();
  const m = clean.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : clean).trim().slice(0, 160);
}
function keywordTags(title) {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are']);
  return String(title || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !stop.has(w)).slice(0, 4);
}
function yamlScalar(v) {
  const s = String(v);
  // Quote if it contains YAML-significant characters.
  if (/[:#\[\]{}",&*!|>%@`]/.test(s) || /^\s|\s$/.test(s) || s === '') {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showError(msg) {
  errorText.textContent = msg;
  errorBanner.classList.add('visible');
  errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function dismissError() { errorBanner.classList.remove('visible'); }
window.dismissError = dismissError;
