require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://supabase.matrixaiserver.com';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('Connecting to Supabase...');
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function createTestCompany() {
  const testUserId = '5fcf581f-f854-459b-b521-aae507891337'; // The ID from setup_test_data.sql

  console.log(`Checking/Creating company for user: ${testUserId}`);

  // 1. Check if user exists
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', testUserId)
    .single();

  if (userError) {
    console.error('Error fetching user:', userError);
    // If user doesn't exist, create it
    console.log('Creating test user...');
    const { error: createUserError } = await supabase
        .from('users')
        .insert([{
            id: testUserId,
            email: 'testadmin@example.com',
            name: 'Test Admin',
            role: 'admin'
        }]);
    if (createUserError) {
        console.error('Error creating user:', createUserError);
        return;
    }
  }

  // 2. Create a company
  const companyName = 'Test Company ' + Date.now();
  console.log(`Creating company: ${companyName}`);
  
  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert([{
      name: companyName,
      // Add other required fields if any. Based on schema, name might be enough?
      // Assuming 'admin_id' or similar might be required if companies table has it?
      // User didn't provide companies schema, but mentioned 'admin_id' in routes/companies.js logic.
      // Let's try inserting just name first, or check companies schema if possible.
      // But routes/companies.js line 103 checks 'admin_id'.
      // So let's try adding admin_id.
      admin_id: testUserId 
    }])
    .select()
    .single();

  if (companyError) {
    console.error('Error creating company:', companyError);
    // If column admin_id doesn't exist, try without it
    if (companyError.message.includes('admin_id')) {
        console.log('Retrying without admin_id...');
        const { data: company2, error: companyError2 } = await supabase
            .from('companies')
            .insert([{ name: companyName }])
            .select()
            .single();
        
        if (companyError2) {
            console.error('Error creating company (retry):', companyError2);
            return;
        }
        handleSuccess(company2, testUserId);
        return;
    }
    return;
  }

  handleSuccess(company, testUserId);
}

async function handleSuccess(company, testUserId) {
    console.log('Company created:', company);

    // 3. Update user with company_id
    console.log(`Updating user ${testUserId} with company_id: ${company.id}`);
    const { error: updateError } = await supabase
        .from('users')
        .update({ company_id: company.id })
        .eq('id', testUserId);

    if (updateError) {
        console.error('Error updating user:', updateError);
    } else {
        console.log('User updated successfully.');
    }
}

createTestCompany();
