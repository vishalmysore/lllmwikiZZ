const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const router = express.Router();

/**
 * CORS-bypass proxy for LLM API calls.
 * Mirrors the pattern used in QuantumMeetsAI's cloudflare-worker.js and Vite dev proxy.
 *
 * Usage: POST /api/proxy
 *   Headers:
 *     x-target-url  — the real LLM API endpoint to forward the request to
 *     Authorization — passed through to the target API
 *   Body: forwarded as-is to the target URL
 *
 * Security:
 *   - Only whitelisted target domains are allowed
 *   - Sensitive proxy-specific headers are stripped before forwarding
 */

const ALLOWED_TARGETS = [
  'https://integrate.api.nvidia.com',
  'https://api.openai.com',
  'https://api.anthropic.com',
  'https://generativelanguage.googleapis.com'
];

router.post('/', (req, res) => {
  const targetUrlStr = req.headers['x-target-url'];

  if (!targetUrlStr) {
    return res.status(400).json({ error: 'Missing x-target-url header' });
  }

  // Validate the target against the whitelist
  const isAllowed = ALLOWED_TARGETS.some(t => targetUrlStr.startsWith(t));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Target URL not whitelisted for this proxy' });
  }

  try {
    const targetUrl = new URL(targetUrlStr);
    const client = targetUrl.protocol === 'https:' ? https : http;

    // Build outgoing headers — forward only what's needed
    const outgoingHeaders = {
      'Content-Type': req.headers['content-type'] || 'application/json'
    };

    // Pass through auth headers
    if (req.headers['authorization']) {
      outgoingHeaders['Authorization'] = req.headers['authorization'];
    }
    if (req.headers['x-api-key']) {
      outgoingHeaders['x-api-key'] = req.headers['x-api-key'];
    }
    if (req.headers['anthropic-version']) {
      outgoingHeaders['anthropic-version'] = req.headers['anthropic-version'];
    }

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: outgoingHeaders,
      rejectUnauthorized: false
    };

    const proxyReq = client.request(options, (proxyRes) => {
      // Set CORS headers on the response
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-target-url, x-api-key, anthropic-version');
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: `Bad Gateway: ${err.message}` });
      }
    });

    // Forward the request body
    if (req.body && typeof req.body === 'object') {
      proxyReq.write(JSON.stringify(req.body));
      proxyReq.end();
    } else {
      req.pipe(proxyReq, { end: true });
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: `Proxy Error: ${err.message}` });
    }
  }
});

// Handle CORS preflight
router.options('/', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-target-url, x-api-key, anthropic-version');
  res.set('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

module.exports = router;
