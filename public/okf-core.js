/**
 * okf-core.js — shared, dependency-free Open Knowledge Format (OKF v0.1) serializer.
 *
 * Single source of truth used by both the OKF Wiki Builder (okf.js) and the
 * AWS RODA → OKF engine (roda.js). Pure functions only (no DOM, no globals),
 * so the same verified logic produces identical, spec-conformant output everywhere.
 *
 * OKF spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
 */

// ---------- text helpers ----------
export function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// A valid OKF `type` is a short concrete category. Reject sentences / echoed schema
// hints (e.g. "Concept type, e.g. Playbook, Entity, ...") and fall back to "Reference".
export function cleanType(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Reference';
  if (/\be\.?g\.?\b|[,:;]/i.test(s)) return 'Reference';
  if (s.length > 30 || s.split(/\s+/).length > 3) return 'Reference';
  return s;
}

export function yamlScalar(v) {
  const s = String(v);
  if (/[:#\[\]{}",&*!|>%@`]/.test(s) || /^\s|\s$/.test(s) || s === '') {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function firstSentence(text) {
  const clean = String(text || '').replace(/^#+\s.*$/gm, '').replace(/\s+/g, ' ').trim();
  const m = clean.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : clean).trim().slice(0, 160);
}

export function keywordTags(title) {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'is', 'are']);
  return String(title || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length > 2 && !stop.has(w)).slice(0, 4);
}

// ---------- concept serialization ----------
export function serializeConcept(c, timestamp) {
  const fm = ['---'];
  fm.push(`type: ${yamlScalar(cleanType(c.type))}`);       // required, non-empty, sanitized
  if (c.id)          fm.push(`id: ${yamlScalar(c.id)}`);    // bundle-relative path for graph routing
  if (c.title)       fm.push(`title: ${yamlScalar(c.title)}`);
  if (c.description) fm.push(`description: ${yamlScalar(c.description)}`);
  if (c.resource)    fm.push(`resource: ${yamlScalar(c.resource)}`);
  if (c.tags && c.tags.length) {
    fm.push('tags:');
    for (const t of c.tags) fm.push(`  - ${yamlScalar(t)}`);
  }
  fm.push(`timestamp: ${timestamp}`);
  fm.push('---');
  const heading = `# ${c.title || c.slug}`;
  return `${fm.join('\n')}\n\n${heading}\n\n${String(c.body || '').trim()}\n`;
}

function rank(path) {
  if (path === 'index.md') return 0;
  if (path === 'log.md')   return 1;
  return 2;
}

/**
 * Build a full OKF bundle file list from concepts.
 * @param {string} bundleName  kebab-case bundle/directory name
 * @param {Array}  concepts    [{slug,type,title,description,tags,resource,body}]
 * @param {object} opts        { method, source, blurb }
 * @returns {Array<{path,content}>}
 */
export function serializeOkfBundle(bundleName, concepts, opts = {}) {
  const { method = 'client-side', source = '', blurb = '' } = opts;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const files = [];

  // Concept files. Each gets an explicit bundle-relative `id` so agents can map the
  // graph deterministically without inferring paths from filenames.
  for (const c of concepts) {
    c.id = `${bundleName}/${c.slug}`;
    files.push({ path: `${c.slug}.md`, content: serializeConcept(c, now) });
  }

  const origin = source ? `, generated from \`${source}\`` : '';
  const indexBody =
`---
okf_version: "0.1"
title: ${yamlScalar(bundleName)}
timestamp: ${now}
---

# ${bundleName}

A knowledge bundle in **Open Knowledge Format (OKF)**${origin}.
${blurb ? '\n' + blurb + '\n' : ''}
> OKF is a directory of markdown files with YAML frontmatter — readable by humans,
> parseable by agents, diffable in git. See the
> [OKF spec](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

## Concepts
${concepts.map(c => `* [${c.title}](/${c.slug}.md) — ${c.description || 'No description.'}`).join('\n')}
`;
  files.push({ path: 'index.md', content: indexBody });

  const src = source ? `\`${source}\`` : 'input';
  const logBody =
`# Log

## ${today}
**Creation** — Generated ${concepts.length} concept${concepts.length === 1 ? '' : 's'} from ${src} via ${method}.
`;
  files.push({ path: 'log.md', content: logBody });

  files.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
  return files;
}

/** Split markdown into concepts at H1–H3 headings (used by "Quick Build"). */
export function conceptsFromHeadings(text, sourceName = 'document') {
  const lines = String(text || '').split(/\r?\n/);
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
      current = { level: 1, title: 'Overview', body: [line] };
    }
  }
  if (current) sections.push(current);
  if (sections.length === 0) sections.push({ level: 1, title: 'Document', body: lines });

  const used = new Set();
  return sections.map(s => {
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
      description: firstSentence(bodyText) || `Section "${s.title}" of ${sourceName}.`,
      tags: keywordTags(s.title),
      body: bodyText || '_No content._',
    };
  }).filter(Boolean);
}

// ---------- ZIP (store-only, pure JS) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Build a store-only ZIP Blob from [{name, data:Uint8Array}] entries. */
export function makeZip(entries) {
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
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, e.data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + e.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

/** Convenience: bundle files -> zip Blob under a top-level dir. */
export function bundleToZip(bundleName, files) {
  const enc = new TextEncoder();
  return makeZip(files.map(f => ({ name: `${bundleName}/${f.path}`, data: enc.encode(f.content) })));
}
