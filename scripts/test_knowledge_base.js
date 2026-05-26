'use strict';

/**
 * Knowledge Base API Test Script
 * Tests all endpoints end-to-end including the DOCX file from Supabase storage
 */

require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');

const BASE = 'http://localhost:6789';
const ADMIN_EMAIL = 'admin@matrixaiglobal.com';
const ADMIN_PASS  = 'admin123';

// The test DOCX file URL
const TEST_DOCX_URL = 'https://supabase.matrixaiserver.com/storage/v1/object/public/user-uploads/generated-docs/document_06da0e62-f918-451e-ba39-f6180932bde3.docx';

let token = '';
let fileId = '';
let chunkId = '';

// ─── helpers ──────────────────────────────────────────────────────────────────

function pass(label, data) {
  console.log(`\n  ✅  ${label}`);
  if (data !== undefined) console.log('     ', JSON.stringify(data, null, 2).slice(0, 300));
}

function fail(label, err) {
  console.error(`\n  ❌  ${label}`);
  const msg = err?.response?.data || err?.message || err;
  console.error('     ', JSON.stringify(msg, null, 2).slice(0, 500));
}

async function run(label, fn) {
  try {
    const result = await fn();
    pass(label, result);
    return result;
  } catch (err) {
    fail(label, err);
    return null;
  }
}

// ─── tests ────────────────────────────────────────────────────────────────────

async function testLogin() {
  const res = await axios.post(`${BASE}/api/auth/login`, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASS
  });
  token = res.data.token;
  return { role: res.data.user.role, tokenLength: token.length };
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

async function testListFiles_Empty() {
  const res = await axios.get(`${BASE}/api/knowledge-base/files`, {
    headers: authHeaders()
  });
  return { total: res.data.total, files: res.data.files?.length };
}

async function testUploadDocx_ParseMode() {
  // 1. Download the DOCX from Supabase storage
  console.log('\n  ⬇️  Downloading DOCX from Supabase storage...');
  const fileRes = await axios.get(TEST_DOCX_URL, { responseType: 'arraybuffer', timeout: 30000 });
  const fileBuffer = Buffer.from(fileRes.data);
  console.log(`     Downloaded ${fileBuffer.length} bytes`);

  // 2. Upload to KB endpoint
  const form = new FormData();
  form.append('file', fileBuffer, {
    filename: 'test_document.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  form.append('processing_mode', 'parse');

  const res = await axios.post(`${BASE}/api/knowledge-base/upload`, form, {
    headers: { ...authHeaders(), ...form.getHeaders() },
    timeout: 180000   // 3 min for embedding
  });

  fileId = res.data.fileId;
  return { fileId, totalChunks: res.data.totalChunks };
}

async function testGetFile() {
  if (!fileId) { console.log('     Skipped (no fileId)'); return null; }
  const res = await axios.get(`${BASE}/api/knowledge-base/files/${fileId}`, {
    headers: authHeaders()
  });
  return { id: res.data.file.id, status: res.data.file.status, totalChunks: res.data.file.total_chunks };
}

async function testGetChunks() {
  if (!fileId) { console.log('     Skipped (no fileId)'); return null; }
  const res = await axios.get(`${BASE}/api/knowledge-base/files/${fileId}/chunks`, {
    headers: authHeaders()
  });
  const chunks = res.data.chunks;
  if (chunks?.length > 0) chunkId = chunks[0].id;
  return { total: res.data.total, firstChunkPreview: chunks?.[0]?.content?.slice(0, 100) };
}

async function testEditChunk() {
  if (!chunkId) { console.log('     Skipped (no chunkId)'); return null; }
  const res = await axios.put(`${BASE}/api/knowledge-base/chunks/${chunkId}`, {
    content: 'Updated test content for chunk - manually edited by admin'
  }, { headers: authHeaders() });
  return { updated: res.data.chunk?.content?.slice(0, 80) };
}

async function testReEmbed() {
  if (!chunkId) { console.log('     Skipped (no chunkId)'); return null; }
  const res = await axios.post(`${BASE}/api/knowledge-base/chunks/${chunkId}/re-embed`, {}, {
    headers: authHeaders(),
    timeout: 30000
  });
  return { message: res.data.message };
}

async function testUpdateAndEmbed() {
  if (!chunkId) { console.log('     Skipped (no chunkId)'); return null; }
  const res = await axios.post(`${BASE}/api/knowledge-base/chunks/${chunkId}/update-and-embed`, {
    content: 'Final updated content - both edited and re-embedded in one request'
  }, { headers: authHeaders(), timeout: 30000 });
  return { message: res.data.message, content: res.data.chunk?.content?.slice(0, 60) };
}

async function testListFiles_AfterUpload() {
  const res = await axios.get(`${BASE}/api/knowledge-base/files?page=1&limit=5`, {
    headers: authHeaders()
  });
  return { total: res.data.total, files: res.data.files?.map(f => ({ id: f.id, name: f.original_name, status: f.status, chunks: f.total_chunks })) };
}

async function testDeleteFile() {
  if (!fileId) { console.log('     Skipped (no fileId)'); return null; }
  const res = await axios.delete(`${BASE}/api/knowledge-base/files/${fileId}`, {
    headers: authHeaders()
  });
  return { message: res.data.message };
}

// ─── auth error test (no token) ───────────────────────────────────────────────

async function testUnauthorized() {
  try {
    await axios.get(`${BASE}/api/knowledge-base/files`);
    return 'ERROR: expected 401 but got 200';
  } catch (err) {
    if (err.response?.status === 401) return { status: 401, message: err.response.data.message };
    throw err;
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Knowledge Base API Tests');
  console.log('══════════════════════════════════════════════');

  await run('1. Login as admin',              testLogin);
  await run('2. Unauthorized access (no token)', testUnauthorized);
  await run('3. List files (current)',         testListFiles_Empty);
  await run('4. Upload DOCX (parse mode) — downloads from Supabase then processes', testUploadDocx_ParseMode);
  await run('5. Get file by ID',              testGetFile);
  await run('6. Get chunks for file',         testGetChunks);
  await run('7. Edit chunk content',          testEditChunk);
  await run('8. Re-embed chunk',              testReEmbed);
  await run('9. Update + embed chunk',        testUpdateAndEmbed);
  await run('10. List files (after upload)',  testListFiles_AfterUpload);
  // Step 11 (Delete) skipped intentionally — verify data persists in Supabase dashboard

  console.log('\n══════════════════════════════════════════════');
  console.log('  Done');
  console.log('══════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
