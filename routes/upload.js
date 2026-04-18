const express = require('express');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { extractText } = require('../services/fileParser');

const router = express.Router();

const ALLOWED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
];

/**
 * POST /api/upload
 * Expects multer middleware to have already processed the file.
 * The documentStore Map is attached via app.locals.
 */
router.post('/', async (req, res) => {
  const documentStore = req.app.locals.documentStore;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    // Validate MIME type server-side
    if (!ALLOWED_MIMES.includes(req.file.mimetype)) {
      // Clean up the uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Please upload a PDF, DOCX, or TXT file.' });
    }

    // Extract text
    const { text, truncated } = await extractText(req.file.path, req.file.mimetype);

    // Delete the raw file after parsing
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      // File may already be cleaned up — non-critical
    }

    // Store in memory
    const documentId = nanoid(8);
    documentStore.set(documentId, {
      text,
      filename: req.file.originalname,
      uploadedAt: Date.now()
    });

    res.json({
      documentId,
      filename: req.file.originalname,
      charCount: text.length,
      preview: text.substring(0, 300) + (text.length > 300 ? '...' : ''),
      truncated
    });

  } catch (err) {
    // Clean up file on error
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }

    const status = err.message.includes('Unsupported file type') ? 400
      : err.message.includes('Could not extract') ? 422
      : 500;

    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
