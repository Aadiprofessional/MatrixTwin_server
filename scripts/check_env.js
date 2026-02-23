
require('dotenv').config();
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Not Set');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'Not Set');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not Set');
