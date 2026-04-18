require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

// Routes
const uploadRoute = require('./routes/upload');
const queryRoute = require('./routes/query');
const providersRoute = require('./routes/providers');
const proxyRoute = require('./routes/proxy');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10) * 1024 * 1024;
const DOC_TTL = (parseFloat(process.env.DOC_TTL_HOURS) || 1) * 60 * 60 * 1000;
const RATE_LIMIT_RPM = parseInt(process.env.RATE_LIMIT_RPM, 10) || 10;

// --- In-memory document store ---
const documentStore = new Map();
app.locals.documentStore = documentStore;

// Proxy URL — when set, LLM requests are routed through /api/proxy
app.locals.proxyUrl = process.env.PROXY_URL || '';

// Cleanup: remove entries older than TTL
setInterval(() => {
  const cutoff = Date.now() - DOC_TTL;
  for (const [id, doc] of documentStore) {
    if (doc.uploadedAt < cutoff) documentStore.delete(id);
  }
}, 10 * 60 * 1000);

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_RPM,
  message: { error: "You've made too many requests. Please wait a minute." },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/query', limiter);

// --- Multer setup ---
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Please upload a PDF, DOCX, or TXT file.'));
    }
  }
});

// --- Routes ---
app.use('/api/providers', providersRoute);
app.use('/api/upload', upload.single('file'), uploadRoute);
app.use('/api/query', queryRoute);
app.use('/api/proxy', proxyRoute);

// --- Multer error handler ---
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File must be under 10MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('Please upload')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`🧠 LLM WikiZZ running at http://localhost:${PORT}`);
});
