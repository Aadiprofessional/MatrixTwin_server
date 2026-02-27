
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Use anon key for now since service key is missing, but auth.users requires service key usually.
// However, we are checking PUBLIC tables, so anon key should work if RLS allows or if we have a token.
// We don't have a token for the user, but we can try with the provided JWT in the logs if needed.
// Or just try anonymously.

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TARGET_ID = 'c2d38f58-5d57-4d6b-a81a-b7baca9ca294';

async function check() {
  console.log(`Checking ID: ${TARGET_ID}`);

  // 1. Check users table
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', TARGET_ID)
    .single();

  if (userError) {
    console.log('User lookup error (or not found):', userError.message);
  } else {
    console.log('Found in USERS table:', user);
  }

  // 2. Check company_members table (as ID)
  const { data: member, error: memberError } = await supabase
    .from('company_members')
    .select('*')
    .eq('id', TARGET_ID)
    .single();

  if (memberError) {
    console.log('Company Member lookup error (or not found):', memberError.message);
  } else {
    console.log('Found in COMPANY_MEMBERS table (as member ID):', member);
  }

  // 3. Check company_members table (as user_id)
  const { data: memberByUser, error: memberByUserError } = await supabase
    .from('company_members')
    .select('*')
    .eq('user_id', TARGET_ID);

  if (memberByUserError) {
     console.log('Company Member by User ID lookup error:', memberByUserError.message);
  } else {
     console.log(`Found ${memberByUser ? memberByUser.length : 0} entries in COMPANY_MEMBERS where user_id is target.`);
  }

}

check();
