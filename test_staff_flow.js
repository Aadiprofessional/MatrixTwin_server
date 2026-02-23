const axios = require('axios');

const BASE_URL = 'http://localhost:6789/api';
let ownerToken, ownerId, companyId, projectId;
let memberToken, memberId, requestId;

// Helper to log steps
const log = (msg) => console.log(`\n=== ${msg} ===`);
const errorLog = (msg, err) => {
    console.error(`ERROR: ${msg}`);
    if (err.response) {
        console.error('Status:', err.response.status);
        console.error('Data:', JSON.stringify(err.response.data, null, 2));
    } else {
        console.error(err.message);
    }
};

async function loginOrSignup(email, password, name) {
    try {
        // Try Login
        console.log(`Attempting login for ${email}...`);
        const res = await axios.post(`${BASE_URL}/auth/login`, { email, password });
        return { token: res.data.token, id: res.data.user.id };
    } catch (err) {
        if (err.response && (err.response.status === 400 || err.response.status === 404)) {
            // Try Signup
            console.log(`Login failed, attempting signup for ${email}...`);
            try {
                const res = await axios.post(`${BASE_URL}/auth/signup`, { 
                    email, 
                    password, 
                    name 
                });
                return { token: res.data.token, id: res.data.user.id };
            } catch (signupErr) {
                errorLog('Signup failed', signupErr);
                throw signupErr;
            }
        }
        errorLog('Login failed', err);
        throw err;
    }
}

async function run() {
    try {
        // 1. Setup Owner
        log('1. Setting up Owner');
        const uniqueOwnerEmail = `test.owner.${Date.now()}@example.com`;
        const ownerInit = await loginOrSignup(uniqueOwnerEmail, 'password123', 'Test Owner');
        // ownerInit has role 'user'. We need 'owner'.
        // Use dev-token to upgrade privileges for testing
        const devTokenRes = await axios.get(`${BASE_URL}/auth/dev-token/owner/${ownerInit.id}`);
        ownerToken = devTokenRes.data.token;
        ownerId = ownerInit.id;
        console.log('Owner ID:', ownerId, '(Promoted to Owner via Dev Token)');

        // 2. Create Company
        log('2. Creating Company');
        // Check if owner already has a company
        try {
            const companiesRes = await axios.get(`${BASE_URL}/companies`, {
                headers: { Authorization: `Bearer ${ownerToken}` }
            });
            if (companiesRes.data.length > 0) {
                companyId = companiesRes.data[0].id;
                console.log('Using existing company:', companyId);
            } else {
                const compRes = await axios.post(`${BASE_URL}/companies`, {
                    name: 'Test Company ' + Date.now()
                }, {
                    headers: { Authorization: `Bearer ${ownerToken}` }
                });
                companyId = compRes.data.company.id;
                console.log('Created new company:', companyId);
            }
        } catch (err) {
            errorLog('Failed to get/create company', err);
            // Try to proceed if maybe it's an admin issue? No, owner should be able to.
        }

        if (!companyId) throw new Error('No company ID found/created');

        // 3. Create Project
        log('3. Creating Project');
        try {
            const projRes = await axios.post(`${BASE_URL}/projects/createOwner`, {
                name: 'Test Project ' + Date.now(),
                company_id: companyId,
                status: 'active'
            }, {
                headers: { Authorization: `Bearer ${ownerToken}` }
            });
            projectId = projRes.data.id;
            console.log('Created Project:', projectId);
        } catch (err) {
            errorLog('Failed to create project', err);
            throw err;
        }

        // 4. Setup Member
        log('4. Setting up Member');
        // Use a unique email to avoid "already in company" issues if we re-run
        const uniqueMemberEmail = `test.member.${Date.now()}@example.com`;
        const member = await loginOrSignup(uniqueMemberEmail, 'password123', 'Test Member');
        memberToken = member.token;
        memberId = member.id;
        console.log('Member ID:', memberId);

        // 5. Member Join Request
        log('5. Member Join Request');
        try {
            await axios.post(`${BASE_URL}/companies/join`, {
                company_id: companyId
            }, {
                headers: { Authorization: `Bearer ${memberToken}` }
            });
            console.log('Join request sent');
        } catch (err) {
            errorLog('Failed to send join request', err);
            throw err;
        }

        // 6. Owner Approves Request
        log('6. Owner Approves Request');
        try {
            const reqsRes = await axios.get(`${BASE_URL}/companies/requests`, {
                headers: { Authorization: `Bearer ${ownerToken}` }
            });
            const request = reqsRes.data.find(r => r.user.id === memberId && r.status === 'pending');
            if (!request) {
                throw new Error('Join request not found');
            }
            requestId = request.id;
            console.log('Found Request ID:', requestId);

            await axios.put(`${BASE_URL}/companies/requests/${requestId}/approve`, {}, {
                headers: { Authorization: `Bearer ${ownerToken}` }
            });
            console.log('Request approved');
        } catch (err) {
            errorLog('Failed to approve request', err);
            throw err;
        }

        // 7. Verify Company Members
        log('7. Verify Company Members API');
        try {
            const membersRes = await axios.get(`${BASE_URL}/companies/members`, {
                headers: { Authorization: `Bearer ${ownerToken}` },
                params: { company_id: companyId }
            });
            console.log('Company Members Count:', membersRes.data.length);
            const isMemberPresent = membersRes.data.find(m => m.user.id === memberId);
            if (isMemberPresent) console.log('Member verified in list');
            else console.error('Member NOT found in list');
        } catch (err) {
            errorLog('Failed to get company members', err);
        }

        // 8. Assign Member to Project
        log('8. Assign Member to Project');
        try {
            await axios.post(`${BASE_URL}/projects/${projectId}/members`, {
                userIds: [memberId]
            }, {
                headers: { Authorization: `Bearer ${ownerToken}` }
            });
            console.log('Member assigned to project');
        } catch (err) {
            errorLog('Failed to assign member', err);
        }

        // 9. Verify Project Members
        log('9. Verify Project Members API');
        try {
            const projMembersRes = await axios.get(`${BASE_URL}/projects/${projectId}/members`, {
                headers: { Authorization: `Bearer ${ownerToken}` }
            });
            console.log('Project Members:', JSON.stringify(projMembersRes.data, null, 2));
        } catch (err) {
            errorLog('Failed to get project members', err);
        }

        // 10. Verify Staff Allocation
        log('10. Verify Staff Allocation API');
        try {
            const staffRes = await axios.get(`${BASE_URL}/projects/${projectId}/staff-allocation`, {
                headers: { Authorization: `Bearer ${ownerToken}` }
            });
            console.log('Staff Allocation:', JSON.stringify(staffRes.data, null, 2));
            
            // Validation
            const assigned = staffRes.data.assigned;
            if (assigned.find(u => u.id === memberId)) {
                console.log('SUCCESS: Member found in "assigned" list');
            } else {
                console.error('FAILURE: Member NOT found in "assigned" list');
            }
        } catch (err) {
            errorLog('Failed to get staff allocation', err);
        }

    } catch (err) {
        console.error('Script failed:', err.message);
    }
}

run();
