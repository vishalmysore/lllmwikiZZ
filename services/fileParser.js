const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extract text content from a file based on its MIME type.
 * Supports PDF, DOCX, and TXT formats.
 * @param {string} filePath - Absolute path to the uploaded file
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<string>} - Extracted plain text
 */
async function extractText(filePath, mimeType) {
  let text = '';

  switch (mimeType) {
    case 'application/pdf': {
      const dataBuffer = fs.readFileSync(filePath);
      // pagerender: null avoids canvas dependency issues
      const result = await pdfParse(dataBuffer, { pagerender: null });
      text = result.text;
      break;
    }

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
      break;
    }

    case 'text/plain': {
      text = fs.readFileSync(filePath, 'utf-8');
      break;
    }

    default:
      throw new Error('Unsupported file type. Please upload a PDF, DOCX, or TXT file.');
  }

  // Strip excessive whitespace and blank lines
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Check minimum content
  if (text.length < 50) {
    throw new Error('Could not extract readable text from this file. Try a different file.');
  }

  // Truncate very long documents
  const MAX_CHARS = 30000;
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.substring(0, MAX_CHARS);
    truncated = true;
  }

  return { text, truncated };
}

module.exports = { extractText };
