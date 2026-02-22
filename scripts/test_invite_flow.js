const axios = require('axios');

const API_URL = 'http://localhost:5000/api';
const ADMIN_EMAIL = 'admin@matrixaiglobal.com';
const ADMIN_PASSWORD = 'admin123';

// Helper to create unique email
const timestamp = Date.now();
const NEW_USER_EMAIL = `invitee_${timestamp}@test.com`;
const NEW_USER_PASSWORD = 'password123';
const NEW_USER_NAME = `Invitee User ${timestamp}`;

async function runTest() {
  try {
    console.log('--- Starting Invite & Join Flow Test ---');

    // 1. Login as Admin/Owner
    console.log(`\n1. Logging in as Owner (${ADMIN_EMAIL})...`);
    let adminToken;
    try {
      const loginRes = await axios.post(`${API_URL}/auth/login`, {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
      });
      adminToken = loginRes.data.token;
      console.log('   Success! Token received.');
    } catch (error) {
      console.error('   Login failed:', error.response?.data || error.message);
      return;
    }

    // 2. Get Owner's Company
    console.log('\n2. Fetching Owner Companies...');
    let companyCode;
    let companyId;
    try {
      const companiesRes = await axios.get(`${API_URL}/companies`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      
      if (companiesRes.data.length === 0) {
        console.log('   No companies found. Creating one...');
        const createRes = await axios.post(`${API_URL}/companies`, {
            name: `Matrix Test Company ${timestamp}`,
            address: '123 Test St',
            phone: '555-0100',
            email: `company_${timestamp}@test.com`
        }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        companyId = createRes.data.id;
        companyCode = createRes.data.code;
        console.log(`   Created Company: ${createRes.data.name} (Code: ${companyCode})`);
      } else {
        const company = companiesRes.data[0];
        companyId = company.id;
        companyCode = company.code;
        console.log(`   Found Company: ${company.name} (Code: ${companyCode})`);
      }
    } catch (error) {
      console.error('   Failed to fetch/create company:', error.response?.data || error.message);
      return;
    }

    if (!companyCode) {
        console.error('   Error: Company has no code!');
        return;
    }

    // 3. Invite a User (Optional - verifies email sending)
    console.log(`\n3. Sending Invite to ${NEW_USER_EMAIL}...`);
    try {
        await axios.post(`${API_URL}/companies/invite`, {
            email: NEW_USER_EMAIL
        }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log('   Invite sent successfully!');
    } catch (error) {
        console.error('   Invite failed (might be SMTP config):', error.response?.data || error.message);
        // Continue anyway, as the code-based join doesn't technically require the email to be sent successfully
    }

    // 4. Signup New User with Company Code
    console.log(`\n4. Signing up new user with Code: ${companyCode}...`);
    let userToken;
    let userId;
    try {
        const signupRes = await axios.post(`${API_URL}/auth/signup`, {
            name: NEW_USER_NAME,
            email: NEW_USER_EMAIL,
            password: NEW_USER_PASSWORD,
            company_code: companyCode
        });
        userToken = signupRes.data.token;
        userId = signupRes.data.user.id; // Note: structure might be nested
        if (!userId && signupRes.data.user) userId = signupRes.data.user.id;
        
        console.log(`   Signup successful! User ID: ${userId}`);
    } catch (error) {
        console.error('   Signup failed:', error.response?.data || error.message);
        return;
    }

    // 5. Verify Join Request exists (As Admin)
    console.log('\n5. Verifying Join Request (Admin View)...');
    let requestId;
    try {
        const requestsRes = await axios.get(`${API_URL}/companies/requests`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        
        const request = requestsRes.data.find(r => r.user_id === userId); // Adjust if user_id is nested
        // The API likely returns { id, user: { ... }, ... }
        // Let's check the structure based on previous implementation
        
        if (request) {
            requestId = request.id;
            console.log(`   Found Request ID: ${requestId} for User: ${request.user?.email || request.user_id}`);
        } else {
            console.log('   Request not found in list. Full list:', JSON.stringify(requestsRes.data, null, 2));
            // Try to find by filtering if structure is different
             const found = requestsRes.data.find(r => r.user?.email === NEW_USER_EMAIL);
             if (found) {
                 requestId = found.id;
                 console.log(`   Found Request ID: ${requestId} (matched by email)`);
             }
        }
    } catch (error) {
        console.error('   Failed to fetch requests:', error.response?.data || error.message);
        return;
    }

    if (!requestId) {
        console.error('   Error: Join request not created!');
        return;
    }

    // 6. Approve Request
    console.log(`\n6. Approving Request ${requestId}...`);
    try {
        await axios.post(`${API_URL}/companies/requests/${requestId}/approve`, {}, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log('   Request approved!');
    } catch (error) {
        console.error('   Approval failed:', error.response?.data || error.message);
        return;
    }

    // 7. Verify User is now in Company (As User)
    // We can check the user's profile or try to access a company-protected route
    // But simplest is to check the user object returned by login (if updated) or fetch profile
    // Or we can check if the user shows up in company members list (if that API exists)
    // Let's just assume success if approval worked, but maybe try to login again to see if company_id is present
    
    console.log('\n7. Verifying User Membership...');
    try {
        // Re-login to get fresh token/data
        const reLoginRes = await axios.post(`${API_URL}/auth/login`, {
            email: NEW_USER_EMAIL,
            password: NEW_USER_PASSWORD
        });
        
        const userData = reLoginRes.data.user;
        if (userData.company_id === companyId) {
            console.log(`   Success! User is now member of Company ID: ${userData.company_id}`);
        } else {
            console.log(`   Warning: User company_id is ${userData.company_id}, expected ${companyId}`);
        }
    } catch (error) {
        console.error('   Verification failed:', error.response?.data || error.message);
    }

    console.log('\n--- Test Completed ---');

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

runTest();
