# LLM WikiZZ — Full App Specification

> A Node.js web app that lets users upload a document, ask questions, and see side-by-side answers: one plain (without WikiZZ framing) and one enriched with 5W1H context (with WikiZZ framing).

---

## 1. Overview

LLM WikiZZ demonstrates how wrapping document queries in structured 5W1H context (Who, What, When, Where, Why, How) improves LLM answers — inspired by Andrej Karpathy's LLM Wiki pattern combined with ZeeSpec-style context framing.

Users bring their own LLM API key (Anthropic, OpenAI, or Google Gemini), upload a document, fill in 5W1H context, type a query, and see both answers rendered side-by-side with an AI-generated comparison verdict.

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20+ | LTS, broad ecosystem |
| Framework | Express.js | Lightweight, no boilerplate |
| Frontend | Vanilla HTML/CSS/JS (single file per view) | No build step needed, easy to ship |
| File parsing | `pdf-parse`, `mammoth` (docx), native for .txt | Cover the three common formats |
| LLM calls | Node `fetch` (built-in 18+) | No SDK dependency, works with all providers |
| Storage | In-memory (session object) + local disk for uploads | Simple, no DB needed for MVP |
| File uploads | `multer` | Standard Express middleware |
| Environment | `dotenv` | Local dev config |

---

## 3. Project Structure

```
llm-wikizz/
├── server.js              # Express app entry point
├── package.json
├── .env.example
├── /routes
│   ├── upload.js          # POST /api/upload
│   ├── query.js           # POST /api/query
│   └── providers.js       # GET /api/providers
├── /services
│   ├── fileParser.js      # Extract text from PDF, DOCX, TXT
│   ├── llmClient.js       # Unified LLM caller (Anthropic / OpenAI / Gemini)
│   ├── promptBuilder.js   # Build plain vs WikiZZ prompts
│   └── comparator.js      # Generate verdict comparing two answers
├── /public
│   ├── index.html         # Main single-page UI
│   ├── style.css
│   └── app.js             # Frontend JS
├── /uploads               # Temp storage for uploaded files (gitignored)
└── README.md
```

---

## 4. Core Concepts

### 4.1 Plain Mode
The document text is sent to the LLM with the user's query and no additional framing.

```
System: You are a helpful assistant. Answer the user's question based only on the provided document.

User:
Document:
{document_text}

Question: {query}
```

### 4.2 WikiZZ Mode (5W1H Framing)
The same query is sent but wrapped in structured 5W1H context, giving the LLM rich situational awareness.

```
System: You are a helpful assistant. Answer the user's question based only on the provided document.

Context about this request:
- Who is asking / who this is for: {who}
- What they need to accomplish: {what}
- When / timing context: {when}
- Where / situational context: {where}
- Why this matters: {why}
- How the answer should be structured: {how}

Use this context to tailor your answer specifically to this person's situation and needs.

User:
Document:
{document_text}

Question: {query}
```

### 4.3 Verdict
After both answers are returned, a third LLM call asks the model to compare them and explain specifically what changed and whether WikiZZ framing improved the answer.

---

## 5. API Routes

### POST /api/upload
Upload a document and extract its text.

**Request:** `multipart/form-data`
- `file` — PDF, DOCX, or TXT (max 10MB)

**Response:**
```json
{
  "documentId": "abc123",
  "filename": "policy.pdf",
  "charCount": 4821,
  "preview": "First 300 characters of extracted text..."
}
```

**Behavior:**
- Parse file based on MIME type
- Store extracted text in a server-side session map keyed by `documentId`
- Delete the raw file after parsing (keep only text in memory)
- Return preview so the user can confirm correct extraction

---

### POST /api/query
Run both plain and WikiZZ queries against the stored document.

**Request body:**
```json
{
  "documentId": "abc123",
  "apiKey": "sk-...",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "query": "What does this employee need to do?",
  "zeespec": {
    "who": "HR manager at 200-person tech company",
    "what": "Advise employee on parental leave steps",
    "when": "Employee just announced pregnancy, 6 months out",
    "where": "Canada, internal company policy",
    "why": "Need to give clear next-steps guidance",
    "how": "Step-by-step, plain language, key dates highlighted"
  }
}
```

**Response (streamed or standard JSON):**
```json
{
  "plain": {
    "answer": "According to the policy...",
    "tokensUsed": 312,
    "latencyMs": 1840
  },
  "wikizz": {
    "answer": "As an HR manager advising...",
    "tokensUsed": 389,
    "latencyMs": 2100
  },
  "verdict": {
    "summary": "The WikiZZ answer was more actionable because...",
    "improvements": ["More specific timeline", "Addressed HR manager perspective", "Plain language as requested"]
  }
}
```

**Behavior:**
- Look up document text by `documentId`
- Call LLM twice in parallel (plain + WikiZZ)
- After both complete, run a third verdict call
- Return all three results together

---

### GET /api/providers
Returns the list of supported LLM providers and their available models.

**Response:**
```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "keyPlaceholder": "sk-ant-...",
      "models": [
        { "id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4 (recommended)" },
        { "id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5 (fast)" }
      ]
    },
    {
      "id": "openai",
      "name": "OpenAI",
      "keyPlaceholder": "sk-...",
      "models": [
        { "id": "gpt-4o", "name": "GPT-4o (recommended)" },
        { "id": "gpt-4o-mini", "name": "GPT-4o Mini (fast)" }
      ]
    },
    {
      "id": "gemini",
      "name": "Google Gemini",
      "keyPlaceholder": "AIza...",
      "models": [
        { "id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash (recommended)" },
        { "id": "gemini-1.5-pro", "name": "Gemini 1.5 Pro" }
      ]
    }
  ]
}
```

---

## 6. LLM Client (`/services/llmClient.js`)

Unified caller that normalises requests across providers.

```javascript
// Interface
async function callLLM({ provider, apiKey, model, system, userMessage, maxTokens })
// Returns: { text, tokensUsed, latencyMs }
```

### Anthropic
```
POST https://api.anthropic.com/v1/messages
Headers: x-api-key, anthropic-version: 2023-06-01
Body: { model, max_tokens, system, messages: [{ role: "user", content: userMessage }] }
```

### OpenAI
```
POST https://api.openai.com/v1/chat/completions
Headers: Authorization: Bearer {apiKey}
Body: { model, messages: [{ role: "system", content: system }, { role: "user", content: userMessage }] }
```

### Google Gemini
```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
Body: { contents: [{ parts: [{ text: system + "\n\n" + userMessage }] }] }
```

---

## 7. File Parser (`/services/fileParser.js`)

```javascript
async function extractText(filePath, mimeType)
// Returns: string (plain text)
```

| MIME type | Library | Notes |
|---|---|---|
| `application/pdf` | `pdf-parse` | Works on most PDFs; warn user if scanned/image |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `mammoth` | Extracts raw text, ignores formatting |
| `text/plain` | `fs.readFile` | Direct read |

- Strip excessive whitespace and blank lines after extraction
- If extracted text is under 50 characters, return an error: "Could not extract readable text from this file."
- Truncate at 30,000 characters with a warning if the document is very long

---

## 8. Frontend UI (`/public/index.html`)

### Layout
Single-page app, no framework. Three vertical sections:

```
[ Header: LLM WikiZZ logo + tagline ]

[ Step 1: API Key & Provider ]
  - Provider dropdown (Anthropic / OpenAI / Gemini)
  - Model dropdown (populated from /api/providers)
  - API key input (password type, never logged or stored server-side)

[ Step 2: Upload Document ]
  - Drag-and-drop zone OR file picker
  - Accepted formats: PDF, DOCX, TXT
  - After upload: show filename, character count, text preview (collapsible)

[ Step 3: 5W1H Context (WikiZZ framing) ]
  - Six labeled text inputs: Who / What / When / Where / Why / How
  - Each has a placeholder example
  - Collapsible section so it doesn't overwhelm first-time users
  - Toggle: "Use WikiZZ framing" checkbox (if unchecked, only plain mode runs)

[ Step 4: Your Query ]
  - Textarea for the question
  - "Run Comparison" button

[ Results ]
  - Two-column layout:
    LEFT:  "Without WikiZZ" (plain answer)
    RIGHT: "With WikiZZ" (enriched answer)
  - Below both: "What changed?" verdict card
  - Metrics row: tokens used, latency per call
  - "Copy answer" button on each column
  - "Run again" button to go back to query step
```

### States
- `idle` — initial state, steps 1-4 visible
- `uploading` — spinner on upload zone
- `running` — "Calling LLM..." on button, both answer columns show skeleton loaders
- `results` — answers shown, verdict shown
- `error` — red banner with error message, retry option

---

## 9. Session & Memory

No database. Use a simple server-side Map:

```javascript
// In server.js
const documentStore = new Map();
// Key: documentId (nanoid 8 chars)
// Value: { text, filename, uploadedAt }

// Cleanup: remove entries older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, doc] of documentStore) {
    if (doc.uploadedAt < cutoff) documentStore.delete(id);
  }
}, 10 * 60 * 1000);
```

API keys are never stored server-side. They are sent per-request from the frontend and used only during that request lifecycle.

---

## 10. Security & Privacy

- API keys: sent in request body, used immediately, never logged, never stored
- Uploaded files: deleted from disk immediately after text extraction
- Document text: kept in memory for 1 hour max, then purged
- No authentication required (MVP — single-user local tool)
- Rate limiting: 10 requests per minute per IP using `express-rate-limit`
- File size limit: 10MB via multer
- Allowed MIME types: enforce server-side, not just client-side

---

## 11. Error Handling

| Scenario | User-facing message |
|---|---|
| Invalid API key | "API key rejected by {provider}. Please check your key." |
| File too large | "File must be under 10MB." |
| Unsupported file type | "Please upload a PDF, DOCX, or TXT file." |
| Empty extraction | "Could not extract readable text. Try a different file." |
| LLM timeout (>30s) | "The LLM took too long to respond. Try a shorter document or simpler query." |
| Rate limit hit | "You've made too many requests. Please wait a minute." |
| Document not found | "Session expired. Please re-upload your document." |

---

## 12. package.json Dependencies

```json
{
  "name": "llm-wikizz",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.8.0",
    "nanoid": "^3.3.7",
    "express-rate-limit": "^7.3.1",
    "dotenv": "^16.4.5",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "nodemon": "^3.1.4"
  }
}
```

> Note: Use `nanoid@3` (CommonJS compatible) not v4+ which is ESM-only.

---

## 13. Environment Variables (`.env.example`)

```
PORT=3000
MAX_FILE_SIZE_MB=10
DOC_TTL_HOURS=1
RATE_LIMIT_RPM=10
```

No LLM keys in `.env` — users supply their own per request.

---

## 14. README Quick Start

```bash
git clone <repo>
cd llm-wikizz
npm install
cp .env.example .env
node server.js
# Open http://localhost:3000
```

---

## 15. Future Enhancements (out of scope for MVP)

- Streaming responses (SSE) for real-time token streaming
- Session persistence via SQLite so document survives page refresh
- Multiple documents per session (LLM Wiki multi-source mode)
- Auto-populate 5W1H fields using a quick LLM call based on the document content
- Export results as PDF or Markdown
- Shareable result links (read-only)
- LLM Wiki ingest mode: save Q&A pairs to a growing wiki that improves future answers
- Dark mode toggle

---

## 16. Key Implementation Notes for Your IDE

1. **Start with `server.js`** — set up Express, multer, rate limiter, and mount routes.
2. **Build `fileParser.js` second** — test it independently with sample files before wiring to the route.
3. **Build `llmClient.js` third** — test each provider separately with a hardcoded prompt.
4. **Wire `promptBuilder.js`** — keep prompt construction separate from the HTTP call so it's easy to iterate.
5. **Frontend last** — the backend should work via curl/Postman before touching HTML.
6. **nanoid import**: `const { nanoid } = require('nanoid')` — version 3 only.
7. **pdf-parse quirk**: pass `{ pagerender: null }` option to avoid canvas dependency issues.
8. **Parallel LLM calls**: use `Promise.all([plainCall, wikizzCall])` then follow with the verdict call.
9. **CORS**: enable for `localhost:3000` only in dev; lock down in prod.
10. **No frameworks on frontend**: keep it vanilla — a `<script>` tag doing `fetch` is enough.