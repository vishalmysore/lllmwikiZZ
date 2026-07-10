/**
 * roda.js — Serverless AWS RODA → OKF Engine.
 *
 * 100% client-side pipeline:
 *   1. Local Registry Index   — fuzzy search over a static roda_catalog.json
 *   2. Unauthenticated S3      — anonymous fetch() of bucket listings (XML) + README/metadata
 *   3. WebLLM Smart Builder    — optional concept extraction on WebGPU (blob-URL worker)
 *   4. Deterministic OKF       — shared okf-core serializer + in-memory ZIP
 *
 * No backend, no signing, no COOP/COEP dependency. Public S3 buckets return
 * `Access-Control-Allow-Origin: *`, so direct browser fetch works.
 */

import {
  slugify, cleanType, firstSentence, conceptsFromHeadings,
  serializeOkfBundle, bundleToZip,
} from './okf-core.js';

// ---------- LLM providers (Smart Build only) ----------
const WEBLLM_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', name: 'Llama 3.2 1B  (~0.9 GB) — fastest' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B (~1.1 GB) — fast' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 3B  (~2.0 GB) — good' },
];
const PROVIDERS = [
  { id: 'webllm',    name: 'WebLLM (Local — No API Key)', keyPlaceholder: '', models: WEBLLM_MODELS, endpoint: null },
  { id: 'anthropic', name: 'Anthropic', keyPlaceholder: 'sk-ant-...', models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-haiku-20240307',    name: 'Claude 3 Haiku (fast)' } ],
    endpoint: 'https://api.anthropic.com/v1/messages' },
  { id: 'openai',    name: 'OpenAI', keyPlaceholder: 'sk-...', models: [
      { id: 'gpt-4o', name: 'GPT-4o' }, { id: 'gpt-4o-mini', name: 'GPT-4o Mini (fast)' } ],
    endpoint: 'https://api.openai.com/v1/chat/completions' },
  { id: 'gemini',    name: 'Google Gemini', keyPlaceholder: 'AIza...', models: [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }, { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' } ],
    endpoint: 'https://generativelanguage.googleapis.com' },
];
const DEFAULT_PROXY = 'https://rough-tree-aee4.vishalmysore.workers.dev';

// ---------- state ----------
let CATALOG = [];
let selected = null;      // catalog entry
let profile = null;       // { endpoint, listing:[{key,size}], prefixes:[], readme, readmeName }
let currentBundle = null; // { name, files }

let webllmWorker = null, webllmStatus = 'idle', webllmGen = 0;
let loadResolve = null, loadReject = null, genResolve = null, genReject = null;

// ---------- DOM ----------
const $ = (s) => document.querySelector(s);
const els = {};
document.addEventListener('DOMContentLoaded', init);

async function init() {
  [
    'search-input','results','dataset-detail','detail-name','detail-desc','detail-tags',
    'detail-bucket','explore-btn','explore-status','profile-box','listing-box','readme-box',
    'provider-select','model-select','api-key','toggle-key-vis','cloud-api-section','webllm-section',
    'load-model-btn','webllm-status','webllm-progress-bar-wrap','webllm-progress-bar','webllm-progress-text',
    'proxy-url','bundle-name','quick-build-btn','smart-build-btn','bundle-section','bundle-output',
    'download-zip-btn','error-banner','error-text','build-step',
  ].forEach(id => els[id] = document.getElementById(id));

  els['provider-select'].innerHTML = PROVIDERS.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  updateModels(); updateProviderUI();
  els['proxy-url'].value = localStorage.getItem('quantum_ai_custom_proxy') || DEFAULT_PROXY;

  bindEvents();
  await loadCatalog();
  renderResults('');
}

async function loadCatalog() {
  try {
    const res = await fetch('./roda_catalog.json');
    const data = await res.json();
    CATALOG = data.datasets || [];
  } catch (e) {
    showError('Could not load roda_catalog.json: ' + e.message);
  }
}

function bindEvents() {
  els['search-input'].addEventListener('input', () => renderResults(els['search-input'].value));
  els['explore-btn'].addEventListener('click', exploreBucket);
  els['provider-select'].addEventListener('change', () => { updateModels(); updateProviderUI(); });
  els['toggle-key-vis'].addEventListener('click', () => {
    const pw = els['api-key'].type === 'password';
    els['api-key'].type = pw ? 'text' : 'password';
    els['toggle-key-vis'].textContent = pw ? '🙈' : '👁';
  });
  els['proxy-url'].addEventListener('change', () => {
    let v = els['proxy-url'].value.trim();
    if (v && !v.startsWith('http')) v = 'https://' + v;
    els['proxy-url'].value = v;
    localStorage.setItem('quantum_ai_custom_proxy', v);
  });
  els['load-model-btn'].addEventListener('click', loadWebLLMModel);
  els['quick-build-btn'].addEventListener('click', () => build('quick'));
  els['smart-build-btn'].addEventListener('click', () => build('smart'));
  els['download-zip-btn'].addEventListener('click', () => {
    if (currentBundle) downloadBlob(bundleToZip(currentBundle.name, currentBundle.files), `${currentBundle.name}.zip`);
  });
}

// ---------- Component 1: discovery ----------
function renderResults(query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = CATALOG.map(d => {
    const hay = `${d.id} ${d.name} ${d.description} ${(d.tags || []).join(' ')}`.toLowerCase();
    const score = tokens.length ? tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0) : 1;
    return { d, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  if (!scored.length) {
    els['results'].innerHTML = `<p class="roda-empty">No datasets match "${escapeHtml(query)}".</p>`;
    return;
  }

  // The full catalog can hold 1000+ datasets — render at most CAP cards for a snappy UI.
  const CAP = 60;
  const shown = scored.slice(0, CAP);
  const more = scored.length - shown.length;
  const count = `<div class="roda-count">${scored.length} dataset${scored.length === 1 ? '' : 's'} ${
    query.trim() ? `match “${escapeHtml(query)}”` : 'in catalog'}${more > 0 ? ` — showing first ${CAP}, refine to narrow` : ''}</div>`;

  els['results'].innerHTML = count + shown.map(({ d }) => `
    <button class="roda-result" data-id="${escapeHtml(d.id)}" type="button">
      <div class="roda-result-name">${escapeHtml(d.name)}</div>
      <div class="roda-result-desc">${escapeHtml(d.description)}</div>
      <div class="roda-result-tags">${(d.tags || []).map(t => `<span class="roda-tag">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="roda-result-bucket">s3://${escapeHtml(d.bucket)} · ${escapeHtml(d.region)}</div>
    </button>`).join('');

  els['results'].querySelectorAll('.roda-result').forEach(b =>
    b.addEventListener('click', () => selectDataset(b.dataset.id)));
}

function selectDataset(id) {
  selected = CATALOG.find(d => d.id === id);
  profile = null; currentBundle = null;
  if (!selected) return;
  els['detail-name'].textContent = selected.name;
  els['detail-desc'].textContent = selected.description;
  els['detail-tags'].innerHTML = (selected.tags || []).map(t => `<span class="roda-tag">${escapeHtml(t)}</span>`).join('');
  els['detail-bucket'].textContent = `s3://${selected.bucket}${selected.prefix ? '/' + selected.prefix : ''}  (${selected.region})`;
  els['bundle-name'].value = selected.id;
  els['dataset-detail'].style.display = '';
  els['profile-box'].style.display = 'none';
  els['build-step'].style.display = '';   // build works from metadata; Explore just enriches it
  els['bundle-section'].style.display = 'none';
  els['dataset-detail'].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Component 2: unauthenticated S3 fetcher ----------
function s3Endpoint(d) { return `https://${d.bucket}.s3.${d.region}.amazonaws.com`; }

async function exploreBucket() {
  if (!selected) return;
  dismissError();
  els['explore-btn'].disabled = true;
  els['explore-status'].textContent = 'Connecting anonymously to S3…';

  const endpoint = s3Endpoint(selected);
  const prefix = selected.prefix || '';
  const profileData = { endpoint, prefix, listing: [], prefixes: [], readme: '', readmeName: '' };

  // 1. Directory listing (anonymous, unsigned — a plain browser GET carries no auth)
  try {
    const url = `${endpoint}/?list-type=2&delimiter=/&max-keys=100${prefix ? '&prefix=' + encodeURIComponent(prefix) : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`S3 responded ${res.status}`);
    const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
    const err = xml.getElementsByTagName('Error')[0];
    if (err) throw new Error(xml.getElementsByTagName('Message')[0]?.textContent || 'S3 error');
    for (const c of xml.getElementsByTagName('Contents')) {
      profileData.listing.push({
        key: c.getElementsByTagName('Key')[0]?.textContent || '',
        size: +(c.getElementsByTagName('Size')[0]?.textContent || 0),
      });
    }
    for (const p of xml.getElementsByTagName('CommonPrefixes')) {
      const pref = p.getElementsByTagName('Prefix')[0]?.textContent;
      if (pref) profileData.prefixes.push(pref);
    }
  } catch (e) {
    els['explore-status'].textContent = '';
    showError(`Could not list the bucket in-browser (${e.message}). You can still build from catalog metadata.`);
  }

  // 2. README / metadata — pick from the ACTUAL listing (avoids blind 404 probing).
  let readmeKey = selected.readme || '';
  if (!readmeKey) {
    const keys = profileData.listing.map(o => o.key);
    readmeKey =
      keys.find(k => /^readme(\.md|\.txt)?$/i.test(k)) ||          // readme / readme.md / readme.txt
      keys.find(k => /(^|\/)readme[^/]*\.(md|txt)$/i.test(k)) ||   // readme-*.md/.txt
      keys.find(k => /^[^/]*\.md$/i.test(k)) || '';                // any top-level .md
  }
  if (readmeKey) {
    try {
      const r = await fetch(`${endpoint}/${readmeKey}`);
      if (r.ok) {
        const txt = await r.text();
        if (txt && txt.length > 40 && !/<Error>/.test(txt)) {
          profileData.readme = txt.slice(0, 8000);
          profileData.readmeName = readmeKey;
        }
      }
    } catch (_) { /* CORS or 404 — ignore */ }
  }

  profile = profileData;
  renderProfile();
  els['explore-btn'].disabled = false;
  els['explore-status'].textContent = profile.listing.length
    ? `Found ${profile.listing.length} objects${profile.prefixes.length ? ` and ${profile.prefixes.length} folders` : ''}${profile.readmeName ? `, plus ${profile.readmeName}` : ''}.`
    : 'No object listing (will build from metadata' + (profile.readmeName ? ` + ${profile.readmeName}` : '') + ').';
  els['build-step'].style.display = '';
}

function renderProfile() {
  els['profile-box'].style.display = '';
  const items = [
    ...profile.prefixes.map(p => `📁 ${escapeHtml(p)}`),
    ...profile.listing.slice(0, 60).map(o => `📄 ${escapeHtml(o.key)}  <span class="roda-size">${fmtSize(o.size)}</span>`),
  ];
  els['listing-box'].innerHTML = items.length
    ? items.map(i => `<div class="roda-file">${i}</div>`).join('')
    : '<div class="roda-file roda-muted">(no objects returned)</div>';
  els['readme-box'].innerHTML = profile.readme
    ? `<div class="roda-readme-title">📖 ${escapeHtml(profile.readmeName)}</div><pre class="roda-readme">${escapeHtml(profile.readme.slice(0, 1500))}${profile.readme.length > 1500 ? '\n…' : ''}</pre>`
    : '';
}

// ---------- Component 4: deterministic OKF build ----------
async function build(mode) {
  if (!selected) return showError('Select a dataset first.');
  dismissError();
  const bundleName = slugify(els['bundle-name'].value.trim()) || selected.id;
  const btn = mode === 'quick' ? els['quick-build-btn'] : els['smart-build-btn'];
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Building…';

  try {
    let concepts, method;
    if (mode === 'quick') {
      concepts = buildDeterministicConcepts(bundleName);
      method = 'AWS RODA + deterministic profiler (client-side)';
    } else {
      concepts = await buildSmartConcepts(bundleName);
      method = `AWS RODA + LLM extraction (${els['provider-select'].value})`;
    }
    const files = serializeOkfBundle(bundleName, concepts, {
      method,
      source: `${selected.bucket} (AWS RODA)`,
      blurb: `Compiled from the AWS Registry of Open Data dataset **${selected.name}**.`,
    });
    currentBundle = { name: bundleName, files };
    renderBundle(files);
    els['bundle-section'].style.display = '';
    els['bundle-section'].scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    showError(e.message || String(e));
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

/** Turn the dataset metadata + S3 profile into a deterministic OKF concept graph. */
function buildDeterministicConcepts(bundleName) {
  const d = selected;
  const endpoint = profile?.endpoint || s3Endpoint(d);
  const resource = `s3://${d.bucket}${d.prefix ? '/' + d.prefix : ''}`;
  const concepts = [];

  // overview (entry concept, links to the others)
  concepts.push({
    slug: 'overview', type: 'Reference', title: d.name,
    description: d.description, resource, tags: d.tags,
    body:
`${d.description}

- **S3 bucket:** \`${resource}\`
- **Region:** \`${d.region}\`
- **HTTPS endpoint:** ${endpoint}/
- **Access:** anonymous / public (no AWS credentials required)

See [[${bundleName}/access]] for how to read it, [[${bundleName}/structure]] for the object layout${profile?.readme ? `, and [[${bundleName}/source-readme]] for the upstream README` : ''}.`,
  });

  // access playbook
  concepts.push({
    slug: 'access', type: 'Playbook', title: `Accessing ${d.name}`,
    description: `How to read the ${d.bucket} bucket anonymously.`, tags: ['access', 's3', 'anonymous'],
    body:
`# Examples

**AWS CLI (no credentials):**
\`\`\`bash
aws s3 ls s3://${d.bucket}/${d.prefix} --no-sign-request --region ${d.region}
\`\`\`

**Direct HTTPS (browser / curl):**
\`\`\`bash
curl "${endpoint}/?list-type=2&max-keys=20${d.prefix ? '&prefix=' + d.prefix : ''}"
\`\`\`

**Python (boto3, unsigned):**
\`\`\`python
import boto3
from botocore import UNSIGNED
from botocore.client import Config
s3 = boto3.client("s3", region_name="${d.region}", config=Config(signature_version=UNSIGNED))
print(s3.list_objects_v2(Bucket="${d.bucket}", Prefix="${d.prefix}", MaxKeys=20))
\`\`\`

Related: [[${bundleName}/overview]]`,
  });

  // structure / schema from the live listing
  const objs = profile?.listing || [];
  const prefixes = profile?.prefixes || [];
  const extCount = {};
  for (const o of objs) {
    const m = o.key.match(/\.([a-z0-9]+)$/i);
    if (m) extCount[m[1].toLowerCase()] = (extCount[m[1].toLowerCase()] || 0) + 1;
  }
  const extLine = Object.entries(extCount).sort((a, b) => b[1] - a[1])
    .map(([e, n]) => `\`.${e}\` ×${n}`).join(', ') || 'n/a';
  concepts.push({
    slug: 'structure', type: 'Schema', title: `${d.name} — Object Layout`,
    description: `Top-level object/prefix structure of ${d.bucket}.`, resource, tags: ['schema', 'structure', 's3'],
    body:
`# Schema

Sampled from a live anonymous \`list-objects-v2\` call against \`${resource}\`.

**File types (sample):** ${extLine}

${prefixes.length ? '**Top-level prefixes (folders):**\n' + prefixes.map(p => `- \`${p}\``).join('\n') + '\n' : ''}
**Sample objects:**
${(objs.slice(0, 25).map(o => `- \`${o.key}\` (${fmtSize(o.size)})`).join('\n')) || '- _(no objects sampled — see catalog metadata)_'}

Related: [[${bundleName}/overview]], [[${bundleName}/access]]`,
  });

  // upstream README, split by headings if it has them
  if (profile?.readme) {
    const headingConcepts = conceptsFromHeadings(profile.readme, profile.readmeName);
    if (headingConcepts.length > 1) {
      headingConcepts.forEach((c, i) => {
        c.slug = 'readme-' + slugify(c.title || ('section-' + (i + 1))).slice(0, 40) || 'readme-' + (i + 1);
        c.type = 'Reference';
      });
      // de-dupe slugs
      const seen = new Set();
      for (const c of headingConcepts) { let s = c.slug, n = 2; while (seen.has(s)) s = c.slug + '-' + n++; c.slug = s; seen.add(s); }
      concepts.push(...headingConcepts);
    } else {
      concepts.push({
        slug: 'source-readme', type: 'Reference', title: `${d.name} — Source README`,
        description: firstSentence(profile.readme) || `Upstream README (${profile.readmeName}).`,
        tags: ['readme', 'documentation'],
        body: `# Citations\n[1] Upstream file: \`${profile.readmeName}\` from \`${resource}\`\n\n---\n\n${profile.readme.slice(0, 6000)}`,
      });
    }
  }
  return concepts;
}

/** Smart Build: ask an LLM for concept JSON, then serialize deterministically. */
async function buildSmartConcepts(bundleName) {
  const isWebLLM = els['provider-select'].value === 'webllm';
  const apiKey = els['api-key'].value.trim();
  if (!isWebLLM && !apiKey) throw new Error('Enter an API key, or use WebLLM / Quick Build.');
  if (isWebLLM && webllmStatus !== 'ready') throw new Error('Load a WebLLM model first.');

  const context =
`Dataset: ${selected.name}
Description: ${selected.description}
S3 bucket: s3://${selected.bucket} (region ${selected.region})
Tags: ${(selected.tags || []).join(', ')}
Sample objects:
${(profile?.listing || []).slice(0, 20).map(o => '- ' + o.key).join('\n') || '(none sampled)'}
${profile?.readme ? '\nREADME excerpt:\n' + profile.readme.slice(0, 4000) : ''}`;

  // Strict directives (per spec §3), but we return JSON and serialize deterministically
  // so structural compliance never depends on the model formatting frontmatter correctly.
  const system =
`You are an OKF v0.1 (Open Knowledge Format) compiler analyzing an AWS Registry of Open Data dataset.
Break it into 3–6 self-contained CONCEPTS. Return ONLY JSON (no markdown fencing):
{"concepts":[{"slug":"kebab-case","type":"ONE word e.g. Reference/Schema/Entity/Playbook — never a sentence or list","title":"","description":"one sentence","tags":[],"body":"markdown; cross-link others with [[${bundleName}/other-slug]]"}]}`;

  const raw = isWebLLM
    ? (await callWebLLM(system, context)).text
    : (await callCloudLLM(PROVIDERS.find(p => p.id === els['provider-select'].value), apiKey, els['model-select'].value, system, context, 2048)).text;

  let jsonStr = raw.trim();
  const m = jsonStr.match(/\{[\s\S]*\}/);
  if (m) jsonStr = m[0];
  let parsed;
  try { parsed = JSON.parse(jsonStr); } catch (_) { throw new Error('LLM did not return valid JSON. Try Quick Build or a stronger model.'); }
  const arr = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  if (!arr.length) throw new Error('No concepts returned.');
  const seen = new Set();
  return arr.map((c, i) => {
    let slug = slugify(c.slug || c.title || `concept-${i + 1}`) || `concept-${i + 1}`;
    let uniq = slug, n = 2; while (seen.has(uniq)) uniq = `${slug}-${n++}`; seen.add(uniq);
    return {
      slug: uniq, type: cleanType(c.type), title: c.title || uniq,
      description: c.description || '', tags: Array.isArray(c.tags) ? c.tags.map(String) : [],
      body: c.body || '_No content._',
    };
  });
}

// ---------- bundle rendering (shared look with okf.html) ----------
function renderBundle(files) {
  const tree = `<div class="okf-tree"><span class="okf-tree-root">${escapeHtml(currentBundle.name)}/</span>${
    files.map(f => `<div class="okf-tree-item">├── ${escapeHtml(f.path)}</div>`).join('')}</div>`;
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
  els['bundle-output'].innerHTML = tree + cards;
  els['bundle-output'].querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    navigator.clipboard.writeText(files[+b.dataset.copy].content).then(() => {
      const t = b.textContent; b.textContent = 'Copied!'; setTimeout(() => b.textContent = t, 1200);
    });
  }));
  els['bundle-output'].querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', () => {
    const f = files[+b.dataset.dl];
    downloadBlob(new Blob([f.content], { type: 'text/markdown' }), f.path.split('/').pop());
  }));
}

// ---------- Component 3: WebLLM (blob-URL worker, no COOP/COEP dependency) ----------
function updateModels() {
  const p = PROVIDERS.find(x => x.id === els['provider-select'].value);
  if (p) els['model-select'].innerHTML = p.models.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
}
function updateProviderUI() {
  const isWebLLM = els['provider-select'].value === 'webllm';
  els['cloud-api-section'].style.display = isWebLLM ? 'none' : '';
  els['webllm-section'].style.display = isWebLLM ? '' : 'none';
  if (!isWebLLM) { const p = PROVIDERS.find(x => x.id === els['provider-select'].value); if (p) els['api-key'].placeholder = p.keyPlaceholder; }
}
async function ensureWorker() {
  if (webllmWorker) return;
  // Blob-URL worker: fetch the same-origin worker source and run it from a blob so it
  // needs no cross-origin-isolation. The worker's web-llm import is an absolute CDN URL.
  const code = await (await fetch('./webllm-worker.js')).text();
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  webllmWorker = new Worker(url, { type: 'module' });
  webllmWorker.onmessage = onWorker;
  webllmWorker.onerror = (e) => {
    webllmStatus = 'error'; setWLStatus('error', e.message || 'Worker crashed');
    loadReject && (loadReject(new Error(e.message)), loadResolve = loadReject = null);
    genReject && (genReject(new Error(e.message)), genResolve = genReject = null);
  };
}
function onWorker(e) {
  const m = e.data;
  switch (m.status) {
    case 'device_detected': setWLStatus('loading', 'WebGPU detected, downloading…'); break;
    case 'phase': setWLStatus('loading', m.note || m.phase); break;
    case 'downloading': setWLStatus('loading', m.file, m.progress); break;
    case 'ready':
      webllmStatus = 'ready'; setWLStatus('ready', `Model ready`);
      els['load-model-btn'].textContent = '✅ Model Loaded'; els['load-model-btn'].disabled = false;
      els['webllm-progress-bar-wrap'].style.display = 'none';
      loadResolve && (loadResolve(m.modelId), loadResolve = loadReject = null); break;
    case 'success':
      genResolve && (genResolve({ text: m.generatedText }), genResolve = genReject = null); break;
    case 'error':
      webllmStatus = 'error'; setWLStatus('error', m.error);
      els['load-model-btn'].textContent = '⬇ Load Model'; els['load-model-btn'].disabled = false;
      els['webllm-progress-bar-wrap'].style.display = 'none';
      loadReject && (loadReject(new Error(m.error)), loadResolve = loadReject = null);
      genReject && (genReject(new Error(m.error)), genResolve = genReject = null); break;
  }
}
function setWLStatus(type, text, progress) {
  els['webllm-status'].textContent = text;
  els['webllm-status'].style.color = type === 'error' ? '#f87171' : type === 'ready' ? '#4ade80' : '#a5b4fc';
  if (progress !== undefined) {
    els['webllm-progress-bar-wrap'].style.display = '';
    els['webllm-progress-bar'].style.width = progress + '%';
    els['webllm-progress-text'].textContent = text;
    els['webllm-status'].textContent = `${progress}%`;
  }
}
async function loadWebLLMModel() {
  dismissError();
  const modelId = els['model-select'].value;
  if (!modelId) return showError('Select a model first.');
  await ensureWorker();
  webllmStatus = 'loading';
  els['load-model-btn'].textContent = 'Loading…'; els['load-model-btn'].disabled = true;
  els['webllm-progress-bar-wrap'].style.display = ''; setWLStatus('loading', 'Initialising…');
  webllmGen++;
  return new Promise((res, rej) => { loadResolve = res; loadReject = rej;
    webllmWorker.postMessage({ action: 'load', modelId, gen: webllmGen });
  }).catch(err => showError(`WebLLM error: ${err.message}`));
}
function callWebLLM(system, user) {
  if (webllmStatus !== 'ready') throw new Error('WebLLM model not loaded.');
  webllmGen++;
  return new Promise((res, rej) => { genResolve = res; genReject = rej;
    webllmWorker.postMessage({ action: 'generate', systemPrompt: system, messages: [{ role: 'user', content: user }], gen: webllmGen });
  });
}

// ---------- cloud LLM (proxy, same protocol as the rest of the app) ----------
async function callCloudLLM(providerDef, apiKey, model, system, userMessage, maxTokens = 2048) {
  let apiEndpoint = providerDef.endpoint;
  if (providerDef.id === 'nvidia' && !apiEndpoint.endsWith('/chat/completions')) apiEndpoint += '/chat/completions';
  const targetUrl = providerDef.id === 'gemini'
    ? `${apiEndpoint}/v1beta/models/${model}:generateContent?key=${apiKey}` : apiEndpoint;
  const fetchUrl = els['proxy-url'].value.trim() || DEFAULT_PROXY;
  const headers = { 'Content-Type': 'application/json', 'x-target-url': targetUrl };
  let body = {};
  if (providerDef.id === 'anthropic') {
    headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01';
    body = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: userMessage }] };
  } else if (providerDef.id === 'openai') {
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
  else if (providerDef.id === 'openai') text = data.choices?.[0]?.message?.content || '';
  else if (providerDef.id === 'gemini') text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text };
}

// ---------- utils ----------
function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showError(msg) { els['error-text'].textContent = msg; els['error-banner'].classList.add('visible'); els['error-banner'].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
function dismissError() { els['error-banner'].classList.remove('visible'); }
window.dismissError = dismissError;
