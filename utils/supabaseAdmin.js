'use strict';

/**
 * Returns a Supabase client that uses the service-role key when available,
 * otherwise falls back to anon key. This bypasses RLS for server-side writes.
 */

const { createClient } = require('@supabase/supabase-js');

let _adminClient = null;

function getAdminClient() {
  if (_adminClient) return _adminClient;

  const url = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set');
  }

  _adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE' : 'ANON';
  console.log(`[supabaseAdmin] client created with ${keyType} key`);

  return _adminClient;
}

// Re-export createSupabaseClient so existing imports keep working
function createSupabaseClient(url, key, options) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false }, ...options });
}

module.exports = { getAdminClient, createSupabaseClient };
