const axios = require('axios');

const BASE_URL = 'http://localhost:6789/api/projects';

// UIDs from instructions
const ADMIN_UID = '95ed2a2f-b239-4b9f-9ae1-cacd6e3f19f4';
const OWNER_UID = '3e4fda0e-3012-4b41-b95a-3ea61c859f39';
const MEMBER_UID = 'b1d0618d-f639-46f2-880b-d6c21560f8e4';

async function setupData() {
    console.log('--- Setting up Test Data ---');
    try {
        // Setup Admin
        await axios.post('http://localhost:6789/api/test/setup', {
            userId: ADMIN_UID,
            role: 'admin',
            companyName: 'Admin Test Company'
        });
        console.log('Admin setup complete');

        // Setup Member (same company)
        await axios.post('http://localhost:6789/api/test/setup', {
            userId: MEMBER_UID,
            role: 'member',
            companyName: 'Admin Test Company'
        });
        console.log('Member setup complete');
        
        // Owner doesn't strictly need a company for listing, but for creation test it helps to know one exists.
        // We will just let Owner list succeed.
        
    } catch (err) {
        console.error('Setup failed (might be expected if RLS blocks):', err.response ? err.response.data : err.message);
    }
}

async function runTests() {
    await setupData();
    console.log('Starting Project API Tests...\n');
    
    let validCompanyId = null;

    // 1. Test Owner List (to get a valid company ID)
    try {
        console.log('--- Test 1: List Projects as Owner ---');
        const res = await axios.get(`${BASE_URL}/list`, {
            headers: {
                'dev-skip-auth': 'true',
                'dev-user-id': OWNER_UID,
                'dev-role': 'owner'
            }
        });
        console.log(`Status: ${res.status}`);
        console.log(`Projects found: ${res.data.length}`);
        if (res.data.length > 0) {
            validCompanyId = res.data[0].company_id;
            console.log(`Found valid company_id: ${validCompanyId}`);
        } else {
            console.warn('No projects found. Create tests might fail if no company_id available.');
        }
    } catch (err) {
        console.error('Owner List failed:', err.response ? err.response.data : err.message);
    }

    // 2. Test Admin List
    try {
        console.log('\n--- Test 2: List Projects as Admin ---');
        const res = await axios.get(`${BASE_URL}/list`, {
            headers: {
                'dev-skip-auth': 'true',
                'dev-user-id': ADMIN_UID,
                'dev-role': 'admin' // Assuming admin role in DB matches
            }
        });
        console.log(`Status: ${res.status}`);
        console.log(`Projects found: ${res.data.length}`);
    } catch (err) {
        console.error('Admin List failed:', err.response ? err.response.data : err.message);
    }

    // 3. Test Member List
    try {
        console.log('\n--- Test 3: List Projects as Member ---');
        const res = await axios.get(`${BASE_URL}/list`, {
            headers: {
                'dev-skip-auth': 'true',
                'dev-user-id': MEMBER_UID,
                'dev-role': 'member'
            }
        });
        console.log(`Status: ${res.status}`);
        console.log(`Projects found: ${res.data.length}`);
    } catch (err) {
        console.error('Member List failed:', err.response ? err.response.data : err.message);
    }

    // 4. Test Create as Admin
    try {
        console.log('\n--- Test 4: Create Project as Admin ---');
        const res = await axios.post(`${BASE_URL}/create`, {
            name: `Admin Project ${Date.now()}`,
            description: "Created by Admin Test Script",
            status: "active",
            location: "Test City",
            client: "Test Client",
            deadline: "2025-01-01"
        }, {
            headers: {
                'dev-skip-auth': 'true',
                'dev-user-id': ADMIN_UID,
                'dev-role': 'admin'
            }
        });
        console.log(`Status: ${res.status}`);
        console.log('Project created:', res.data.id);
        if (!validCompanyId) validCompanyId = res.data.company_id; // Fallback
    } catch (err) {
        console.error('Admin Create failed:', err.response ? err.response.data : err.message);
    }

    // 5. Test Create as Owner
    try {
        console.log('\n--- Test 5: Create Project as Owner ---');
        if (!validCompanyId) {
            console.error('Skipping Owner Create Test: No valid company_id found.');
        } else {
            const res = await axios.post(`${BASE_URL}/createOwner`, {
                name: `Owner Project ${Date.now()}`,
                description: "Created by Owner Test Script",
                status: "active",
                location: "Test City",
                client: "Test Client",
                deadline: "2025-01-01",
                company_id: validCompanyId
            }, {
                headers: {
                    'dev-skip-auth': 'true',
                    'dev-user-id': OWNER_UID,
                    'dev-role': 'owner'
                }
            });
            console.log(`Status: ${res.status}`);
            console.log('Project created:', res.data.id);
        }
    } catch (err) {
        console.error('Owner Create failed:', err.response ? err.response.data : err.message);
    }

    console.log('\nTests completed.');
}

runTests();
