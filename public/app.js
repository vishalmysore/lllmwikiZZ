/**
 * LLM WikiZZ — Frontend Application
 */

// --- State ---
let providers = [];
let currentDocumentId = null;
let wikizzEnabled = true;

// --- DOM references ---
const $ = (sel) => document.querySelector(sel);
const providerSelect = $('#provider-select');
const modelSelect = $('#model-select');
const apiKeyInput = $('#api-key');
const toggleKeyVis = $('#toggle-key-vis');
const uploadZone = $('#upload-zone');
const fileInput = $('#file-input');
const uploadSpinner = $('#upload-spinner');
const uploadSuccess = $('#upload-success');
const uploadFilename = $('#upload-filename');
const uploadMeta = $('#upload-meta');
const uploadPreview = $('#upload-preview');
const previewToggle = $('#preview-toggle');
const truncationWarning = $('#truncation-warning');
const changeFileBtn = $('#change-file-btn');
const wikizzToggle = $('#wikizz-toggle');
const wikizzFields = $('#wikizz-fields');
const queryInput = $('#query-input');
const runBtn = $('#run-btn');
const setupSection = $('#setup-section');
const resultsSection = $('#results-section');
const plainAnswer = $('#plain-answer');
const wikizzAnswer = $('#wikizz-answer');
const plainTokens = $('#plain-tokens');
const plainLatency = $('#plain-latency');
const wikizzTokens = $('#wikizz-tokens');
const wikizzLatency = $('#wikizz-latency');
const verdictSummary = $('#verdict-summary');
const verdictImprovements = $('#verdict-improvements');
const errorBanner = $('#error-banner');
const errorText = $('#error-text');
const runAgainBtn = $('#run-again-btn');
const copyPlainBtn = $('#copy-plain-btn');
const copyWikizzBtn = $('#copy-wikizz-btn');

// --- Init ---
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadProviders();
  bindEvents();
}

// --- Load Providers ---
async function loadProviders() {
  try {
    const res = await fetch('/api/providers');
    const data = await res.json();
    providers = data.providers;

    providerSelect.innerHTML = providers.map(p =>
      `<option value="${p.id}">${p.name}</option>`
    ).join('');

    updateModels();
    updateKeyPlaceholder();
  } catch (err) {
    showError('Failed to load providers. Is the server running?');
  }
}

function updateModels() {
  const provider = providers.find(p => p.id === providerSelect.value);
  if (!provider) return;

  modelSelect.innerHTML = provider.models.map(m =>
    `<option value="${m.id}">${m.name}</option>`
  ).join('');
}

function updateKeyPlaceholder() {
  const provider = providers.find(p => p.id === providerSelect.value);
  if (provider) {
    apiKeyInput.placeholder = provider.keyPlaceholder;
  }
}

// --- Event Bindings ---
function bindEvents() {
  // Provider change
  providerSelect.addEventListener('change', () => {
    updateModels();
    updateKeyPlaceholder();
  });

  // API key visibility toggle
  toggleKeyVis.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVis.textContent = isPassword ? '🙈' : '👁';
  });

  // Upload zone — click
  uploadZone.addEventListener('click', () => fileInput.click());

  // Upload zone — drag & drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileUpload(fileInput.files[0]);
    }
  });

  // Preview toggle
  previewToggle.addEventListener('click', () => {
    const preview = uploadPreview;
    const visible = preview.classList.toggle('visible');
    previewToggle.textContent = visible ? 'Hide preview ▴' : 'Show preview ▾';
  });

  // Change file
  changeFileBtn.addEventListener('click', () => {
    currentDocumentId = null;
    uploadSuccess.classList.remove('visible');
    uploadZone.style.display = '';
    fileInput.value = '';
  });

  // WikiZZ toggle
  wikizzToggle.addEventListener('click', toggleWikizz);
  wikizzToggle.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleWikizz();
    }
  });

  // Run button
  runBtn.addEventListener('click', runQuery);

  // Run again
  runAgainBtn.addEventListener('click', () => {
    resultsSection.classList.remove('visible');
    setupSection.style.display = '';
    // Reset skeleton loaders
    resetResults();
  });

  // Copy buttons
  copyPlainBtn.addEventListener('click', () => copyToClipboard(plainAnswer.textContent, copyPlainBtn));
  copyWikizzBtn.addEventListener('click', () => copyToClipboard(wikizzAnswer.textContent, copyWikizzBtn));
}

function toggleWikizz() {
  wikizzEnabled = !wikizzEnabled;
  wikizzToggle.classList.toggle('active', wikizzEnabled);
  wikizzToggle.setAttribute('aria-checked', wikizzEnabled);
  wikizzFields.classList.toggle('collapsed', !wikizzEnabled);
}

// --- File Upload ---
async function handleFileUpload(file) {
  dismissError();

  // Client-side validation
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];

  if (!allowedTypes.includes(file.type)) {
    showError('Please upload a PDF, DOCX, or TXT file.');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showError('File must be under 10MB.');
    return;
  }

  // Show spinner
  uploadZone.style.display = 'none';
  uploadSpinner.classList.add('visible');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Upload failed.');
    }

    // Store document ID
    currentDocumentId = data.documentId;

    // Show success
    uploadSpinner.classList.remove('visible');
    uploadFilename.textContent = `📎 ${data.filename}`;
    uploadMeta.textContent = `${data.charCount.toLocaleString()} characters extracted`;
    uploadPreview.textContent = data.preview;
    uploadSuccess.classList.add('visible');

    if (data.truncated) {
      truncationWarning.classList.add('visible');
    } else {
      truncationWarning.classList.remove('visible');
    }

  } catch (err) {
    uploadSpinner.classList.remove('visible');
    uploadZone.style.display = '';
    showError(err.message);
  }
}

// --- Run Query ---
async function runQuery() {
  dismissError();

  // Validation
  if (!providerSelect.value) {
    showError('Please select a provider.');
    return;
  }
  if (!apiKeyInput.value.trim()) {
    showError('Please enter your API key.');
    return;
  }
  if (!currentDocumentId) {
    showError('Please upload a document first.');
    return;
  }
  if (!queryInput.value.trim()) {
    showError('Please enter a question.');
    return;
  }

  // Build request body
  const body = {
    documentId: currentDocumentId,
    apiKey: apiKeyInput.value.trim(),
    provider: providerSelect.value,
    model: modelSelect.value,
    query: queryInput.value.trim()
  };

  if (wikizzEnabled) {
    body.zeespec = {
      who: $('#field-who').value.trim(),
      what: $('#field-what').value.trim(),
      when: $('#field-when').value.trim(),
      where: $('#field-where').value.trim(),
      why: $('#field-why').value.trim(),
      how: $('#field-how').value.trim()
    };

    if (!body.zeespec.who || !body.zeespec.what) {
      showError('Please fill in at least the "Who" and "What" fields for WikiZZ framing.');
      return;
    }
  }

  // Switch to running state
  setupSection.style.display = 'none';
  resultsSection.classList.add('visible');
  resetResults();

  runBtn.classList.add('btn-loading');
  runBtn.disabled = true;

  // Show/hide wikizz column
  const wikizzColumn = $('#result-wikizz');
  wikizzColumn.style.display = wikizzEnabled ? '' : 'none';

  // Adjust grid
  const resultsGrid = document.querySelector('.results-grid');
  resultsGrid.style.gridTemplateColumns = wikizzEnabled ? '1fr 1fr' : '1fr';

  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Query failed.');
    }

    // Populate plain answer
    plainAnswer.textContent = data.plain.answer;
    plainTokens.textContent = data.plain.tokensUsed.toLocaleString();
    plainLatency.textContent = `${(data.plain.latencyMs / 1000).toFixed(1)}s`;

    if (wikizzEnabled && data.wikizz) {
      // Populate WikiZZ answer
      wikizzAnswer.textContent = data.wikizz.answer;
      wikizzTokens.textContent = data.wikizz.tokensUsed.toLocaleString();
      wikizzLatency.textContent = `${(data.wikizz.latencyMs / 1000).toFixed(1)}s`;

      // Populate verdict
      if (data.verdict) {
        verdictSummary.textContent = data.verdict.summary;
        verdictImprovements.innerHTML = data.verdict.improvements
          .map(imp => `<li>${escapeHtml(imp)}</li>`)
          .join('');
      }
      $('#verdict-card').style.display = '';
    } else {
      $('#verdict-card').style.display = 'none';
    }

  } catch (err) {
    showError(err.message);
    // Go back to setup
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
    <div class="skeleton skeleton-line"></div>
  `;
  plainAnswer.innerHTML = skeletonHTML;
  wikizzAnswer.innerHTML = skeletonHTML;
  plainTokens.textContent = '—';
  plainLatency.textContent = '—';
  wikizzTokens.textContent = '—';
  wikizzLatency.textContent = '—';
  verdictSummary.innerHTML = `
    <span class="skeleton skeleton-line" style="width:90%"></span>
    <span class="skeleton skeleton-line" style="width:75%"></span>
  `;
  verdictImprovements.innerHTML = '';
}

// --- Error Handling ---
function showError(message) {
  errorText.textContent = message;
  errorBanner.classList.add('visible');
  errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function dismissError() {
  errorBanner.classList.remove('visible');
}

// --- Utilities ---
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
