/**
 * Shared client-side PDF text extraction via pdf.js — no server, no build step.
 *
 * Loaded lazily (only when a PDF is actually uploaded) so the ~1 MB library isn't
 * fetched on every page load. Used by both app.js (WikiZZ) and okf.js (OKF builder).
 *
 * COEP note: this site runs cross-origin-isolated (coi-serviceworker sets
 * Cross-Origin-Embedder-Policy: require-corp so WebLLM's SharedArrayBuffer works).
 * Under that policy a cross-origin Worker is disallowed outright, so we fetch the
 * pdf.js worker source from the CDN (it sends ACAO:* + CORP:cross-origin) and run it
 * from a same-origin blob URL.
 */

const PDFJS_VERSION = '4.7.76';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let _pdfjsPromise = null;

async function ensurePdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    const pdfjs = await import(`${PDFJS_BASE}/pdf.min.mjs`);
    try {
      // Same-origin blob worker (cross-origin workers are blocked under COEP).
      const res = await fetch(`${PDFJS_BASE}/pdf.worker.min.mjs`);
      if (!res.ok) throw new Error(`worker fetch ${res.status}`);
      const code = await res.text();
      const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      pdfjs.GlobalWorkerOptions.workerSrc = blobUrl;
    } catch (e) {
      // Fallback: let pdf.js run on a main-thread "fake worker" (slower, but works).
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
    }
    return pdfjs;
  })();
  return _pdfjsPromise;
}

/** True if the file looks like a PDF (by MIME type or extension). */
export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

/**
 * Extract plain text from a PDF ArrayBuffer.
 * @param {ArrayBuffer} arrayBuffer
 * @param {{maxPages?: number, onProgress?: (page:number,total:number)=>void}} [opts]
 * @returns {Promise<string>}
 */
export async function extractPdfText(arrayBuffer, opts = {}) {
  const { maxPages = 200, onProgress } = opts;
  const pdfjs = await ensurePdfjs();

  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  const out = [];

  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines: pdf.js flags the last item on a visual line with hasEOL.
    let line = '';
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) { lines.push(line); line = ''; }
      else if (item.str && !item.str.endsWith(' ')) line += ' ';
    }
    if (line.trim()) lines.push(line);
    out.push(lines.join('\n').replace(/[ \t]+\n/g, '\n').trim());
    if (onProgress) onProgress(i, pages);
  }

  try { await doc.cleanup(); } catch (_) {}
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
