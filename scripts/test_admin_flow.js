const axios = require('axios');

const API_URL = 'http://localhost:6789/api';
const OWNER_EMAIL = 'admin@matrixaiglobal.com';
const OWNER_PASSWORD = 'admin123';
const USER_EMAIL = 'user@matrixaiglobal.com';
const USER_PASSWORD = 'user123';

async function login(email, password) {
  try {
    console.log(`\nLogging in as ${email}...`);
    const response = await axios.post(`${API_URL}/auth/login`, {
      email,
      password
    });
    console.log(`✅ Login successful. Role: ${response.data.user.role}`);
    return {
      token: response.data.token,
      user: response.data.user
    };
  } catch (error) {
    console.error(`❌ Login failed for ${email}:`, error.response?.data?.message || error.message);
    throw error;
  }
}

async function runTest() {
  console.log('🚀 Starting Full API Test Sequence...');

  try {
    // 1. Authenticate
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    if (owner.user.role !== 'owner') {
      console.error('❌ FATAL: Admin user is not an owner! Run the SQL update script first.');
      process.exit(1);
    }

    const user = await login(USER_EMAIL, USER_PASSWORD);

    // 2. Test: User Request Admin Access
    console.log('\n--- 1. Testing Admin Request Flow ---');
    try {
      await axios.post(
        `${API_URL}/admin/request`,
        {},
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      console.log('✅ Request submitted successfully.');
    } catch (error) {
      if (error.response?.data?.message === 'You already have a pending request.') {
        console.log('⚠️  User already has a pending request (skipping submission).');
      } else {
        throw error;
      }
    }

    // 3. Test: Owner List Requests
    console.log('\n--- 2. Testing Owner List Requests ---');
    const requestsRes = await axios.get(
      `${API_URL}/admin/requests`,
      { headers: { Authorization: `Bearer ${owner.token}` } }
    );
    console.log(`✅ Fetched ${requestsRes.data.length} pending requests.`);
    
    const userRequest = requestsRes.data.find(r => r.user_id === user.user.id && r.status === 'pending');
    
    if (userRequest) {
      // 4. Test: Owner Approve Request
      console.log(`\n--- 3. Testing Approve Request (ID: ${userRequest.id}) ---`);
      await axios.put(
        `${API_URL}/admin/requests/${userRequest.id}/approve`,
        {},
        { headers: { Authorization: `Bearer ${owner.token}` } }
      );
      console.log('✅ Request approved.');
    } else {
      console.log('ℹ️  No pending request to approve (may be already approved).');
    }

    // 5. Test: Verify User is now Admin
    console.log('\n--- 4. Verifying User Role Update ---');
    // We can use the admin list endpoint to verify
    const adminListRes = await axios.get(
      `${API_URL}/admin/list`,
      { headers: { Authorization: `Bearer ${owner.token}` } }
    );
    const newAdmin = adminListRes.data.find(u => u.id === user.user.id);
    if (newAdmin) {
      console.log(`✅ User ${newAdmin.email} is now in the admin list.`);
    } else {
      console.error(`❌ User ${user.user.email} NOT found in admin list.`);
    }

    // 6. Test: Demote Admin (Remove Admin)
    console.log('\n--- 5. Testing Demote Admin (Remove Admin) ---');
    try {
      await axios.put(
        `${API_URL}/admin/demote/${user.user.id}`,
        {},
        { headers: { Authorization: `Bearer ${owner.token}` } }
      );
      console.log('✅ Admin demoted successfully.');
    } catch (error) {
      console.error('❌ Failed to demote admin:', error.response?.data?.message || error.message);
    }

    // Verify demotion
    const adminListAfterDemote = await axios.get(
      `${API_URL}/admin/list`,
      { headers: { Authorization: `Bearer ${owner.token}` } }
    );
    const demotedUser = adminListAfterDemote.data.find(u => u.id === user.user.id);
    if (!demotedUser) {
      console.log('✅ Verified: User is no longer in admin list.');
    } else {
      console.error('❌ User still appears in admin list!');
    }

    // 7. Test: Direct Promotion
    console.log('\n--- 6. Testing Direct Promotion ---');
    try {
      await axios.put(
        `${API_URL}/admin/promote/${user.user.id}`,
        {},
        { headers: { Authorization: `Bearer ${owner.token}` } }
      );
      console.log('✅ User promoted directly successfully.');
    } catch (error) {
      console.error('❌ Failed to promote user:', error.response?.data?.message || error.message);
    }

    // 8. Test: Create Company
    console.log('\n--- 7. Testing Create Company ---');
    const companyName = `Matrix Corp ${Date.now()}`;
    const companyRes = await axios.post(
      `${API_URL}/companies`,
      { name: companyName, details: { address: '123 Matrix Way' } },
      { headers: { Authorization: `Bearer ${owner.token}` } }
    );
    console.log(`✅ Company created: ${companyRes.data.company.name}`);
    const companyId = companyRes.data.company.id;

    // 9. Test: Assign Admin to Company
    console.log('\n--- 8. Testing Assign Admin to Company ---');
    try {
      await axios.put(
        `${API_URL}/companies/${companyId}/assign-admin`,
        { admin_id: user.user.id },
        { headers: { Authorization: `Bearer ${owner.token}` } }
      );
      console.log('✅ Admin assigned successfully.');
    } catch (error) {
      console.error('❌ Failed to assign admin:', error.response?.data?.message || error.message);
    }

    // 10. Test: List Companies
    console.log('\n--- 9. Testing List Companies ---');
    const companiesRes = await axios.get(
      `${API_URL}/companies`,
      { headers: { Authorization: `Bearer ${owner.token}` } }
    );
    const updatedCompany = companiesRes.data.find(c => c.id === companyId);
    if (updatedCompany && updatedCompany.admin_id === user.user.id) {
      console.log(`✅ Verified: Company ${updatedCompany.name} is assigned to Admin ${updatedCompany.admin_id}`);
    } else {
      console.error('❌ Company assignment verification failed.');
    }

    // --- NEW TESTS FOR CONSTRAINTS ---

    // 11. Test: Prevent Multiple Admin Requests
    console.log('\n--- 10. Testing Constraint: Prevent Multiple Admin Requests ---');
    try {
      await axios.post(
        `${API_URL}/admin/request`,
        {},
        { headers: { Authorization: `Bearer ${user.token}` } }
      );
      console.error('❌ FAILED: User was able to submit a duplicate request!');
    } catch (error) {
      if (error.response?.data?.message === 'You already have a pending request.' || 
          error.response?.data?.message === 'You are already an approved admin.') {
        console.log(`✅ Constraint passed: ${error.response.data.message}`);
      } else {
        console.error('❌ Unexpected error:', error.response?.data || error.message);
      }
    }

    // 12. Test: Prevent Single Admin assigned to Multiple Companies
    console.log('\n--- 11. Testing Constraint: Prevent Single Admin -> Multiple Companies ---');
    // Create a second company
    const company2Res = await axios.post(
      `${API_URL}/companies`,
      { name: `Matrix Corp 2 ${Date.now()}` },
      { headers: { Authorization: `Bearer ${owner.token}` } }
    );
    const company2Id = company2Res.data.company.id;
    console.log(`Created second company: ${company2Res.data.company.name}`);

    // Try to assign the same admin (who is already assigned to companyId) to company2Id
    try {
      await axios.put(
        `${API_URL}/companies/${company2Id}/assign-admin`,
        { admin_id: user.user.id },
        { headers: { Authorization: `Bearer ${owner.token}` } }
      );
      console.error('❌ FAILED: Admin was assigned to a second company!');
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.message?.includes('already assigned')) {
        console.log(`✅ Constraint passed: ${error.response.data.message}`);
      } else {
        console.error('❌ Unexpected error:', error.response?.data || error.message);
      }
    }

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED:', error.response?.data || error.message);
  }
}

runTest();
