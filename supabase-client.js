const { createClient } = require('@supabase/supabase-js');

/**
 * Create a Supabase client with the given URL and key
 * @param {string} supabaseUrl - The Supabase project URL
 * @param {string} supabaseKey - The Supabase API key
 * @param {object} options - Additional options for the client
 * @returns {object} Supabase client instance
 */
function createSupabaseClient(supabaseUrl, supabaseKey, options = {}) {
  if (!supabaseUrl) {
    throw new Error('Supabase URL is required');
  }
  
  if (!supabaseKey) {
    throw new Error('Supabase key is required');
  }

  const defaultOptions = {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  };

  const clientOptions = { ...defaultOptions, ...options };

  try {
    const client = createClient(supabaseUrl, supabaseKey, clientOptions);
    console.log('Supabase client created successfully');
    return client;
  } catch (error) {
    console.error('Error creating Supabase client:', error);
    throw error;
  }
}

module.exports = {
  createSupabaseClient
}; 