'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { auth, adminOnly } = require('../middleware/auth');
const processor = require('../utils/knowledgeBaseProcessor');
const { getAdminClient } = require('../utils/supabaseAdmin');

// ---------------------------------------------------------------------------
// Multer config (in-memory, 100 MB limit)
// ---------------------------------------------------------------------------

const ALLOWED_EXTS = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTS.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTS.join(', ')}`), false);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf')                               return 'pdf';
  if (['.docx', '.doc'].includes(ext))              return 'docx';
  if (ext === '.txt')                               return 'text';
  if (['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)) return 'image';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/knowledge-base/upload
 * Upload and process a file.
 * Body (multipart/form-data):
 *   file            – the file
 *   processing_mode – "parse" | "vision"  (required for pdf/docx)
 */
router.post('/upload', [auth, adminOnly], upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const supabase = getAdminClient();
    const fileType = getFileType(req.file.originalname);

    if (fileType === 'unknown') {
      return res.status(400).json({ success: false, message: 'Unsupported file type.' });
    }

    // Determine processing mode
    let mode = req.body.processing_mode;
    if (fileType === 'image' || fileType === 'text') {
      mode = fileType === 'image' ? 'vision' : 'parse'; // forced
    } else if (!['parse', 'vision'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'processing_mode must be "parse" or "vision" for PDF/DOCX files.'
      });
    }

    const result = await processor.processFile(
      supabase,
      req.file.buffer,
      req.file.originalname,
      fileType,
      mode
    );

    return res.status(201).json({
      success: true,
      message: 'File processed and embedded successfully.',
      fileId: result.fileId,
      totalChunks: result.totalChunks
    });
  } catch (err) {
    console.error('[KB] Upload error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge-base/files
 * List all uploaded files (paginated).
 * Query: page, limit, status
 */
router.get('/files', [auth, adminOnly], async (req, res) => {
  try {
    const supabase = getAdminClient();
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(100, parseInt(req.query.limit || '20', 10));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('dwss_files')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.status) query = query.eq('status', req.query.status);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ success: true, files: data, total: count, page, limit });
  } catch (err) {
    console.error('[KB] List files error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge-base/files/:fileId
 * Get a single file record.
 */
router.get('/files/:fileId', [auth, adminOnly], async (req, res) => {
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from('dwss_files')
      .select('*')
      .eq('id', req.params.fileId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    return res.json({ success: true, file: data });
  } catch (err) {
    console.error('[KB] Get file error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------

/**
 * GET /api/knowledge-base/files/:fileId/chunks
 * Get all chunks for a file, ordered by chunk_index.
 */
router.get('/files/:fileId/chunks', [auth, adminOnly], async (req, res) => {
  try {
    const supabase = getAdminClient();
    const { fileId } = req.params;

    const { data, error } = await supabase
      .from('dwss_chunks')
      .select('id, content, metadata, created_at')
      .eq('metadata->>file_id', fileId);

    if (error) throw error;

    // Sort by chunk_index stored inside metadata
    const sorted = (data || []).sort((a, b) => {
      const ia = parseInt(a.metadata?.chunk_index ?? 0, 10);
      const ib = parseInt(b.metadata?.chunk_index ?? 0, 10);
      return ia - ib;
    });

    return res.json({ success: true, chunks: sorted, total: sorted.length });
  } catch (err) {
    console.error('[KB] Get chunks error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------

/**
 * PUT /api/knowledge-base/chunks/:chunkId
 * Edit chunk content only (no re-embedding).
 * Body: { content }
 */
router.put('/chunks/:chunkId', [auth, adminOnly], async (req, res) => {
  try {
    const supabase = getAdminClient();
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'content cannot be empty.' });
    }

    const { data, error } = await supabase
      .from('dwss_chunks')
      .update({ content: content.trim() })
      .eq('id', req.params.chunkId)
      .select('id, content, metadata, created_at')
      .single();

    if (error) throw error;

    return res.json({ success: true, message: 'Chunk content updated.', chunk: data });
  } catch (err) {
    console.error('[KB] Update chunk error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------

/**
 * POST /api/knowledge-base/chunks/:chunkId/re-embed
 * Re-create embedding for the current content of a chunk.
 */
router.post('/chunks/:chunkId/re-embed', [auth, adminOnly], async (req, res) => {
  try {
    const supabase = getAdminClient();

    const { data: chunk, error: fetchErr } = await supabase
      .from('dwss_chunks')
      .select('id, content')
      .eq('id', req.params.chunkId)
      .single();

    if (fetchErr || !chunk) {
      return res.status(404).json({ success: false, message: 'Chunk not found.' });
    }

    const embedding = await processor.createEmbedding(chunk.content);

    const { error: updateErr } = await supabase
      .from('dwss_chunks')
      .update({ embedding })
      .eq('id', req.params.chunkId);

    if (updateErr) throw updateErr;

    return res.json({ success: true, message: 'Chunk re-embedded successfully.' });
  } catch (err) {
    console.error('[KB] Re-embed error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------

/**
 * POST /api/knowledge-base/chunks/:chunkId/update-and-embed
 * Update content AND create a fresh embedding in one request.
 * Body: { content }
 */
router.post('/chunks/:chunkId/update-and-embed', [auth, adminOnly], async (req, res) => {
  try {
    const supabase = getAdminClient();
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'content cannot be empty.' });
    }

    const trimmed = content.trim();
    const embedding = await processor.createEmbedding(trimmed);

    const { data, error } = await supabase
      .from('dwss_chunks')
      .update({ content: trimmed, embedding })
      .eq('id', req.params.chunkId)
      .select('id, content, metadata, created_at')
      .single();

    if (error) throw error;

    return res.json({ success: true, message: 'Chunk updated and re-embedded.', chunk: data });
  } catch (err) {
    console.error('[KB] Update+embed error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------

/**
 * DELETE /api/knowledge-base/files/:fileId
 * Delete a file and all its chunks.
 */
router.delete('/files/:fileId', [auth, adminOnly], async (req, res) => {
  try {
    const supabase = getAdminClient();
    const { fileId } = req.params;

    // Delete chunks first (foreign-key safety)
    const { error: chunkErr } = await supabase
      .from('dwss_chunks')
      .delete()
      .eq('metadata->>file_id', fileId);

    if (chunkErr) throw chunkErr;

    const { error: fileErr } = await supabase
      .from('dwss_files')
      .delete()
      .eq('id', fileId);

    if (fileErr) throw fileErr;

    return res.json({ success: true, message: 'File and all associated chunks deleted.' });
  } catch (err) {
    console.error('[KB] Delete file error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
