# Beyond RAG: How to Build Serverless AI Wikis with OKF and AWS RODA Straight in Your Browser

For the last three years, the knee-jerk reaction to any enterprise AI context problem was automated:
"Just build a RAG pipeline." But as we move deeper into 2026, the structural cracks of the
"RAG-everything" approach have become too wide to ignore. Relying on probabilistic vector databases to
guess high-stakes business rules or code schemas is a recipe for hallucinations and broken deployments.

To solve this, a massive architectural shift is underway toward deterministic, human-and-agent-readable
data formats—and it's happening entirely client-side.

Enter **LLM WikiZZ**, an open-source tool changing the game by introducing the **OKF Wiki Builder** and
**AWS RODA → OKF Engine**. By leveraging Google Cloud's open-source
[Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md),
this tool completely replaces expensive, black-box infrastructure with portable, git-native knowledge
bundles consisting of nothing but clean Markdown and YAML frontmatter.

Even better? It bridges this local precision with global scale by integrating directly with the
**Registry of Open Data on AWS (RODA)**. Running 100% in your browser via local WebLLM, you can now parse
massive open cloud datasets anonymously, extract core schemas, and compile spec-conformant OKF knowledge
graphs into downloadable zip bundles with zero servers, zero API keys, and zero configuration.

Here is how LLM WikiZZ is combining OKF and AWS RODA to build a predictable, deterministic, and entirely
free ecosystem for autonomous AI agents—straight from a static webpage.

---

## What is OKF?

[Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
is a minimal, open way to represent knowledge as a plain **directory of Markdown files with YAML
frontmatter**. There's no schema registry and no SDK — `git clone` and `cat` are all you need to
consume a bundle. It's designed to be:

- **Readable** by humans without tooling
- **Parseable** by agents without bespoke SDKs
- **Diffable** in version control
- **Portable** across tools, organizations, and time

A bundle is just:

```
my-bundle/
├── index.md      # entry point + concept listing (declares okf_version)
├── log.md        # change history, newest date first
└── <concept>.md  # one file per concept: YAML frontmatter + Markdown body
```

Every concept file carries a required `type` in its frontmatter; the root `index.md` declares
`okf_version`. That's essentially the whole spec.

---

## The Builder

The OKF Wiki Builder lives at [`public/okf.html`](public/okf.html) and runs **100% in the browser**.
It reuses the same LLM/WebLLM plumbing as the main WikiZZ app but never touches the comparison flow —
it's a standalone module.

![OKF Wiki Builder landing page](docs/okf/01-okf-builder.png)

The on-page primer summarizes the format, then walks you through three steps: pick a provider (only
needed for *Smart Build*), upload a document, and build.

---

## Step 1 — Upload a document (PDF, MD, or TXT)

The uploader accepts **PDF, Markdown, and plain text**. PDFs are parsed entirely client-side with
[pdf.js](https://mozilla.github.io/pdf.js/) — the library is loaded lazily from a CDN and its worker
runs from a same-origin blob (required because the page is cross-origin-isolated for WebLLM).

![PDF uploaded and text extracted client-side](docs/okf/02-pdf-extracted.png)

Here a 2-page `sholay.pdf` was dropped in and **663 characters** were extracted in the browser — no
upload, no server round-trip. Scanned/image-only PDFs are detected and reported with a clear message.

---

## Step 2 — Build the bundle

There are two build modes, both feeding the **same deterministic serializer** so the output is always
spec-conformant:

| Mode | What it does | Needs |
|---|---|---|
| ⚡ **Quick Build** | Splits the document by Markdown headings into concept files | Nothing — fully offline |
| ✨ **Smart Build** | Asks an LLM (cloud or local WebLLM) to extract self-contained concepts | An API key, or a loaded WebLLM model |

For this walkthrough we ran **Quick Build** on the `IndianCookingmethods.md` sample. It split the
document at its headings and produced a complete bundle:

![Generated OKF bundle file tree](docs/okf/03-bundle-tree.png)

`index.md` and `log.md` are generated automatically; each heading became its own concept file.

---

## Step 3 — Inspect the output

### `index.md` — the entry point

The root index declares `okf_version` and lists every concept with a bundle-absolute link:

![Generated index.md with okf_version and concept listing](docs/okf/04-index-md.png)

### A concept file

Each concept is a Markdown file with clean YAML frontmatter. Note the required `type` and the explicit
bundle-relative `id`, which lets an agent map the knowledge graph deterministically without inferring
paths from filenames:

![Generated concept file with type and id](docs/okf/05-concept-file.png)

```yaml
---
type: Subsection
id: indian-cooking-methods/2-dum-slow-steam-cooking
title: 2. Dum (Slow Steam Cooking)
description: The word 'Dum' means to breathe in or literally 'breath'.
tags:
  - dum
  - slow
  - steam
  - cooking
timestamp: 2026-07-09T23:23:42.050Z
---

# 2. Dum (Slow Steam Cooking)

The word 'Dum' means to breathe in or literally 'breath'. This method involves cooking food in a
pot sealed with dough...
```

`log.md` records the creation event, newest date first:

```markdown
# Log

## 2026-07-09
**Creation** — Generated 8 concepts from `IndianCookingmethods.md` via heading-split (client-side).
```

You can copy or download any file individually, or grab the whole thing as a `.zip` (built client-side
with a small store-only ZIP writer — no dependencies).

---

## How it maps to the OKF spec

| Spec requirement | How the builder satisfies it |
|---|---|
| Every non-reserved `.md` has parseable YAML frontmatter | Deterministic serializer emits valid YAML (verified with a YAML parser) |
| Frontmatter has a non-empty `type` | `type` is required; LLM output is sanitized so placeholder/echoed text can't leak in |
| Root `index.md` declares `okf_version` | Emitted as `okf_version: "0.1"` |
| `log.md` records changes, newest first | Auto-generated with a `**Creation**` entry |
| Cross-links | Bundle-absolute `/concept.md` in `index.md`; `[[bundle/concept]]` wiki-links in Smart Build bodies |

Beyond the spec, each concept also gets an `id` (a bundle-relative path) as a custom key — OKF
explicitly allows producers to add custom fields, and consumers preserve unknown keys.

---

## Under the hood

- **Zero server.** Everything — file parsing, concept extraction, serialization, ZIP packaging — runs
  in the browser. Deployed as static files on GitHub Pages.
- **PDF parsing** via pdf.js loaded from CDN on demand, with the worker run from a same-origin blob so
  it works under the site's `Cross-Origin-Embedder-Policy: require-corp` isolation.
- **Deterministic serializer.** Both build modes converge on one code path, so the output structure is
  identical and always conformant, regardless of how messy an LLM's JSON is.
- **Robust `type` handling.** A sanitizer rejects sentences, comma-lists, and echoed schema hints,
  falling back to `Reference` — so you never end up with a `type` like *"Concept type, e.g. Playbook,
  Entity, ..."*.
- **Real ZIP.** A dependency-free store-only ZIP writer produces archives that pass `unzip -t`.

---

## Try it

1. Open [`public/okf.html`](public/okf.html) (or the deployed `/okf.html` on GitHub Pages).
2. Upload a PDF, Markdown, or text file — or click one of the sample links.
3. Hit **⚡ Quick Build** for an instant offline bundle, or **✨ Smart Build** to let an LLM extract
   concepts.
4. Download the bundle and `git commit` it — you now have a portable, agent-ready OKF wiki.

---

*Full bundle view:*

![Full OKF bundle output page](docs/okf/06-okf-bundle-full.png)

---

# Bonus: Compiling a Wiki straight from AWS Open Data (RODA → OKF)

The same OKF serializer powers a second, more ambitious module: the **AWS RODA → OKF Engine**
([`public/roda.html`](public/roda.html)). Instead of uploading a file, you browse the
[Registry of Open Data on AWS](https://registry.opendata.aws/) anonymously, sample a public dataset's
real structure straight from S3, and compile it into an OKF bundle — still 100% in the browser, with
**no server, no credentials, and no proxy**.

The pipeline is four client-side stages:

```
[ 1. Local Registry Index ]  fuzzy-search a static RODA catalog
   └─► [ 2. Unauthenticated S3 Fetcher ]  anonymous fetch() of the bucket listing + README
        └─► [ 3. WebLLM Smart Builder ]   optional WebGPU concept extraction (Blob-URL worker)
             └─► [ 4. Deterministic OKF Serializer ]  in-memory .zip
```

## Step 1 — Search the catalog

`roda_catalog.json` holds the **entire** registry (~1,100+ datasets, real bucket names and regions) and
is fuzzy-searched client-side. It's **auto-generated by a GitHub Actions workflow**
([update-roda-catalog.yml](.github/workflows/update-roda-catalog.yml) +
[build-roda-catalog.mjs](scripts/build-roda-catalog.mjs)) that runs weekly on GitHub's runners — so the
catalog self-refreshes as AWS adds datasets, and *nothing* runs at page-load time; the site stays 100%
static. Here, typing *"climate"* matches 237 datasets (top 60 shown):

![RODA catalog search across the full registry](docs/okf/07-roda-catalog.png)

> Why a build step? AWS's live index sends **no CORS header** and is 14 MB, so a browser can't read it
> directly. A GitHub Actions runner is a server, so it reads the index with no CORS restriction and bakes
> a static catalog into the repo — full coverage, still zero-server at runtime.

### Describe what you want — AI picks the dataset

Keyword search only helps if you already know the vocabulary. The **✨ Recommend a dataset with AI**
button closes that gap with a two-stage retrieval that runs entirely in the browser:

1. **Prefilter (local, instant).** A synonym-expanded lexical match shortlists ~24 candidate datasets —
   so *"how hot are the oceans getting"* expands to *sea surface temperature* and surfaces the MUR SST
   datasets even though the query shares no words with them.
2. **LLM re-rank.** Only those candidates (never the full ~1,100-dataset catalog, which wouldn't fit a
   small model's context window) are handed to WebLLM or a cloud model, which returns the best 1–3 with
   a one-line reason. Selecting a suggestion drops you straight into the Explore → Compile flow.

Typing *"how hot are the oceans getting"* — a query that shares **no words** with the datasets — surfaces
the sea-surface-temperature collections at the top, above the raw keyword results:

![AI Recommend suggesting sea-surface-temperature datasets for a plain-language query](docs/okf/10-roda-recommend.png)

*The dataset names and buckets are real prefilter output. The italic reason lines here are a visible
placeholder from the local test harness — a live model (WebLLM or your cloud key) writes the actual
rationale at runtime; this environment has no GPU or key to run one.*

Verified prefilter behaviour — the LLM then ranks these shortlists:

| You type | Prefilter surfaces (top candidates) |
|---|---|
| how hot are the oceans getting | MUR / GHRSST **Sea Surface Temperature** |
| satellite imagery of european farmland | Sentinel-1 / Sentinel-2 / Sentinel-3 |
| human dna variation across populations | 1000 Genomes + human-genome datasets |
| air pollution in cities | OpenAQ, CMAQ air quality, PM2.5 |
| train a language model on web text | Common Crawl, ParaCrawl web corpora |

## Step 2 — Explore the bucket (anonymous S3)

Selecting NOAA GHCN-D and clicking **Explore bucket** issues a plain, unsigned browser `fetch()` to
`https://noaa-ghcn-pds.s3.us-east-1.amazonaws.com/?list-type=2` — public AWS buckets return
`Access-Control-Allow-Origin: *`, so the XML listing is parsed with `DOMParser` and the `readme.txt`
is pulled directly. No AWS SDK, no signing, no backend:

![Live anonymous S3 listing and README for the NOAA bucket](docs/okf/08-roda-explore.png)

## Step 3 — Compile the OKF bundle

**Quick Build** turns the dataset metadata + the live S3 object layout + the upstream README into a
deterministic OKF concept graph — an `overview` (Reference), an `access` **Playbook** with ready-to-run
AWS CLI / boto3 / curl snippets, a `structure` **Schema** sampled from the live `list-objects-v2` call,
and the source README — all cross-linked with `[[bundle/concept]]` wiki-links and packaged as a valid
`.zip`:

![Compiled OKF bundle from the NOAA RODA dataset](docs/okf/09-roda-bundle.png)

The result is a portable, agent-ready knowledge bundle describing a real petabyte-scale open dataset —
built entirely from a static web page.

### Design notes

- **No COOP/COEP dependency.** This page deliberately does *not* register the COI service worker. S3
  CORS fetches work without cross-origin isolation, and the WebLLM worker is started from a same-origin
  **Blob URL** — so it runs gracefully on any static host.
- **Shared core.** Both the OKF Wiki Builder and the RODA engine import the same `okf-core.js`
  serializer, so a concept file compiled from a NOAA bucket is byte-structurally identical to one built
  from an uploaded PDF.
