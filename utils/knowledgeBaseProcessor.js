'use strict';

const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const axios = require('axios');
const path = require('path');
const { createSupabaseClient, getAdminClient } = require('./supabaseAdmin');

const DEEPINFRA_API_KEY = process.env.DEEPINFRA_API_KEY || 'Fy3YFDDTrOl5fH1tdx16DEeSeEAmNdVa';
const EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-8B';
const VISION_MODEL = 'Qwen/Qwen3-VL-235B-A22B-Instruct';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH_SIZE = 5; // parallel embedding requests

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

async function extractTextFromPDF(buffer) {
  const data = await pdfParse(buffer);
  return data.text || '';
}

async function extractTextFromDOCX(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

// ---------------------------------------------------------------------------
// PDF → images (pdfjs-dist + canvas, no system dependencies)
// ---------------------------------------------------------------------------

async function pdfToImages(buffer) {
  // Lazy-require so the module is optional at startup
  let pdfjsLib;
  let createCanvas;
  try {
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    ({ createCanvas } = require('canvas'));
  } catch (e) {
    throw new Error(
      'PDF-to-image rendering requires "pdfjs-dist" and "canvas" packages. ' +
      'Run: npm install pdfjs-dist@3.11.174 canvas'
    );
  }

  // Disable worker (not needed in Node.js)
  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  }

  const uint8Array = new Uint8Array(buffer);
  const pdfDoc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
  const numPages = pdfDoc.numPages;
  const images = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // 2× for readability

    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const pngBuffer = canvas.toBuffer('image/png');
    images.push(`data:image/png;base64,${pngBuffer.toString('base64')}`);
  }

  return images;
}

// ---------------------------------------------------------------------------
// DOCX → images (via LibreOffice → PDF → pdfjs images)
// ---------------------------------------------------------------------------

async function docxToImages(buffer) {
  let libre;
  try {
    libre = require('libreoffice-convert');
  } catch (_) {
    console.warn(
      '[KB] libreoffice-convert not installed – DOCX vision will fall back to text extraction. ' +
      'Install with: npm install libreoffice-convert  (and install LibreOffice on the system)'
    );
    return null;
  }

  const { promisify } = require('util');
  const convert = promisify(libre.convert);

  try {
    const pdfBuffer = await convert(buffer, '.pdf', undefined);
    return await pdfToImages(Buffer.from(pdfBuffer));
  } catch (err) {
    console.warn('[KB] DOCX → PDF conversion failed, falling back to text:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vision API – extract all text from a base64 data-URL image
// ---------------------------------------------------------------------------

async function extractTextFromImage(dataUrl) {
  const response = await axios.post(
    'https://api.deepinfra.com/v1/openai/chat/completions',
    {
      model: VISION_MODEL,
      max_tokens: 4092,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all text content from this image. Return ONLY the extracted text, preserving formatting. Do not add commentary, explanations, or metadata.'
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl }
            }
          ]
        }
      ]
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPINFRA_API_KEY}`
      },
      timeout: 120000
    }
  );

  return response.data.choices[0].message.content || '';
}

// ---------------------------------------------------------------------------
// Text chunking with smart boundary detection
// ---------------------------------------------------------------------------

function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];

  // Normalise line-endings and collapse excessive blank lines
  const clean = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!clean) return [];

  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);

    if (end < clean.length) {
      // Try paragraph boundary first, then sentence, then newline
      const para     = clean.lastIndexOf('\n\n', end);
      const sentence = clean.lastIndexOf('. ', end);
      const newline  = clean.lastIndexOf('\n', end);
      const boundary = Math.max(para, sentence, newline);

      if (boundary > start + Math.floor(chunkSize / 3)) {
        end = boundary + (clean[boundary] === '.' ? 2 : 1);
      }
    }

    const chunk = clean.substring(start, end).trim();
    if (chunk.length > 20) chunks.push(chunk);

    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Embedding API
// ---------------------------------------------------------------------------

async function createEmbedding(text) {
  const response = await axios.post(
    'https://api.deepinfra.com/v1/openai/embeddings',
    {
      input: text,
      model: EMBEDDING_MODEL,
      encoding_format: 'float'
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPINFRA_API_KEY}`
      },
      timeout: 60000
    }
  );

  return response.data.data[0].embedding;
}

// ---------------------------------------------------------------------------
// MIME type helper
// ---------------------------------------------------------------------------

function getMimeType(ext) {
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png',  '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp'
  };
  return map[ext.toLowerCase()] || 'image/png';
}

// ---------------------------------------------------------------------------
// Main entry point: processFile
// ---------------------------------------------------------------------------

/**
 * Process an uploaded file: extract text (or use vision), chunk, embed, save.
 *
 * @param {object} _supabase       - Ignored; we use the admin client internally for all writes
 * @param {Buffer} fileBuffer      - Raw file buffer
 * @param {string} fileName        - Original filename
 * @param {string} fileType        - 'pdf' | 'docx' | 'image' | 'text'
 * @param {string} processingMode  - 'parse' | 'vision'
 * @returns {{ fileId: string, totalChunks: number }}
 */
async function processFile(_supabase, fileBuffer, fileName, fileType, processingMode) {
  // Always use admin client (service role key) to bypass RLS
  const supabase = getAdminClient();
  // ── 1. Create file record ────────────────────────────────────────────────
  const { data: fileRecord, error: fileError } = await supabase
    .from('dwss_files')
    .insert({
      original_name: fileName,
      file_type: fileType,
      processing_mode: processingMode,
      status: 'processing',
      total_chunks: 0
    })
    .select()
    .single();

  if (fileError) {
    console.error('[KB] Supabase insert error (dwss_files):', JSON.stringify(fileError));
    throw new Error(`Failed to create file record: ${fileError.message} | code: ${fileError.code} | hint: ${fileError.hint}`);
  }

  const fileId = fileRecord.id;

  try {
    // ── 2. Extract text chunks ────────────────────────────────────────────
    let textChunks = [];

    if (fileType === 'image') {
      // Always use vision for standalone images
      const ext = path.extname(fileName).toLowerCase();
      const mime = getMimeType(ext);
      const dataUrl = `data:${mime};base64,${fileBuffer.toString('base64')}`;
      const extracted = await extractTextFromImage(dataUrl);
      textChunks = chunkText(extracted);

    } else if (processingMode === 'parse') {
      // Direct text extraction
      let text = '';
      if (fileType === 'pdf')       text = await extractTextFromPDF(fileBuffer);
      else if (fileType === 'docx') text = await extractTextFromDOCX(fileBuffer);
      else                          text = fileBuffer.toString('utf8');
      textChunks = chunkText(text);

    } else if (processingMode === 'vision') {
      // Convert every page to an image, then run vision API in parallel
      let images = null;

      if (fileType === 'pdf') {
        images = await pdfToImages(fileBuffer);
      } else if (fileType === 'docx') {
        images = await docxToImages(fileBuffer);
        if (!images) {
          // Graceful fallback: text extraction
          console.log('[KB] DOCX vision fallback → text extraction');
          const text = await extractTextFromDOCX(fileBuffer);
          textChunks = chunkText(text);
        }
      }

      if (images && images.length > 0) {
        console.log(`[KB] Running vision API on ${images.length} page(s) in parallel...`);
        const pageTexts = await Promise.all(images.map(img => extractTextFromImage(img)));
        const combined = pageTexts.join('\n\n---\n\n');
        textChunks = chunkText(combined);
      }
    }

    if (textChunks.length === 0) {
      throw new Error('No text content could be extracted from the file.');
    }

    console.log(`[KB] Creating embeddings for ${textChunks.length} chunk(s)...`);

    // ── 3. Create embeddings in batches ───────────────────────────────────
    const chunksWithEmbeddings = [];
    for (let i = 0; i < textChunks.length; i += EMBED_BATCH_SIZE) {
      const batch = textChunks.slice(i, i + EMBED_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (chunk, bi) => ({
          chunk,
          embedding: await createEmbedding(chunk),
          index: i + bi
        }))
      );
      chunksWithEmbeddings.push(...results);
    }

    // ── 4. Save chunks to Supabase ────────────────────────────────────────
    const records = chunksWithEmbeddings.map(({ chunk, embedding, index }) => ({
      content: chunk,
      embedding,           // pgvector accepts a plain JS array
      metadata: {
        file_id: fileId,
        file_name: fileName,
        file_type: fileType,
        processing_mode: processingMode,
        chunk_index: index,
        total_chunks: textChunks.length
      }
    }));

    const { error: insertError } = await supabase.from('dwss_chunks').insert(records);
    if (insertError) {
      console.error('[KB] Supabase insert error (dwss_chunks):', JSON.stringify(insertError));
      throw new Error(`Failed to save chunks: ${insertError.message} | code: ${insertError.code} | hint: ${insertError.hint}`);
    }

    // ── 5. Mark file as completed ─────────────────────────────────────────
    await supabase
      .from('dwss_files')
      .update({ status: 'completed', total_chunks: textChunks.length, updated_at: new Date().toISOString() })
      .eq('id', fileId);

    console.log(`[KB] Done: fileId=${fileId}, chunks=${textChunks.length}`);
    return { fileId, totalChunks: textChunks.length };

  } catch (error) {
    // Mark file as failed
    await supabase
      .from('dwss_files')
      .update({
        status: 'failed',
        metadata: { error: error.message },
        updated_at: new Date().toISOString()
      })
      .eq('id', fileId);

    throw error;
  }
}

module.exports = {
  extractTextFromPDF,
  extractTextFromDOCX,
  pdfToImages,
  docxToImages,
  extractTextFromImage,
  chunkText,
  createEmbedding,
  processFile
};
