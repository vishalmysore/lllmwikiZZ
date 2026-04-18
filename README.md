# LLM WikiZZ

> See how **5W1H context framing** transforms LLM answers — side by side.

Upload a document, fill in Who/What/When/Where/Why/How context, ask a question, and compare the plain answer against the WikiZZ-enriched answer with an AI-generated verdict.

## Quick Start

```bash
npm install
cp .env.example .env
node server.js
# Open http://localhost:3000
```

## Supported Providers

| Provider | Models |
|---|---|
| Anthropic | Claude Sonnet 4, Claude Haiku 4.5 |
| OpenAI | GPT-4o, GPT-4o Mini |
| Google Gemini | Gemini 2.0 Flash, Gemini 1.5 Pro |

Bring your own API key — keys are never stored server-side.

## How It Works

1. **Upload** a PDF, DOCX, or TXT document
2. **Fill in** 5W1H context fields (Who, What, When, Where, Why, How)
3. **Ask** a question about your document
4. **Compare** the plain answer vs the WikiZZ-enriched answer
5. **Read the verdict** — an AI-generated comparison explaining what improved

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JS
- **File Parsing**: pdf-parse, mammoth
- **LLM**: Native fetch (no SDK dependencies)
- **Storage**: In-memory (no database)
