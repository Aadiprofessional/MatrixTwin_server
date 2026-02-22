const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://supabase.matrixaiserver.com';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('code')
      .limit(1);

    if (error) {
      console.log('Error checking schema:', error.message);
      if (error.message.includes('does not exist')) {
        console.log('Schema update needed.');
      }
    } else {
      console.log('Schema check passed: "code" column exists.');
    }
  } catch (err) {
    console.log('Exception:', err.message);
  }
}

checkSchema();
