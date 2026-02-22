const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { sendEmail } = require('../utils/email');

// --- User APIs ---

// 1. Submit Admin Request
router.post('/request-admin', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const { company_name, company_details } = req.body;

        if (!company_name) {
            return res.status(400).json({ message: 'Company name is required' });
        }

        // Check for existing pending request
        const { data: existing, error: fetchError } = await supabase
            .from('admin_requests')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ message: 'You already have a pending request.' });
        }

        const { data: request, error } = await supabase
            .from('admin_requests')
            .insert({
                user_id: userId,
                company_name,
                company_details: company_details || {},
                status: 'pending'
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json(request);
    } catch (err) {
        console.error('Error submitting admin request:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

/**
 * @route   GET /api/admin-requests/my-request
 * @desc    Get the current user's most recent admin request
 * @access  Private
 */
router.get('/my-request', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;

        // Fetch the most recent request for this user
        const { data: request, error } = await supabase
            .from('admin_requests')
            .select('*')
            .eq('user_id', userId)
            .order('requested_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('Error fetching my-request:', error);
            return res.status(500).json({ message: 'Server error fetching request' });
        }

        if (!request) {
            return res.status(404).json({ message: 'No admin request found' });
        }

        // Return the request, including status and rejection_reason
        res.json(request);

    } catch (err) {
        console.error('Error in my-request endpoint:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// 2. Edit/Resubmit Request
router.put('/request-admin/:id', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const userId = req.user.id;
        const requestId = req.params.id;
        const { company_name, company_details } = req.body;

        // Verify ownership and status (can only edit pending or rejected to resubmit)
        const { data: request, error: fetchError } = await supabase
            .from('admin_requests')
            .select('*')
            .eq('id', requestId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        if (request.status === 'approved') {
            return res.status(400).json({ message: 'Cannot edit an approved request.' });
        }

        const updates = {
            updated_at: new Date(),
            status: 'pending' // Resubmit if it was rejected
        };
        if (company_name) updates.company_name = company_name;
        if (company_details) updates.company_details = company_details;

        const { data: updatedRequest, error } = await supabase
            .from('admin_requests')
            .update(updates)
            .eq('id', requestId)
            .select()
            .single();

        if (error) throw error;

        res.json(updatedRequest);
    } catch (err) {
        console.error('Error updating admin request:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- Owner APIs ---

// 3. List All Requests (Owner Only)
router.get('/requests', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        
        // Owner check
        if (req.user.role !== 'owner') {
            return res.status(403).json({ message: 'Access denied. Owner only.' });
        }

        // 1. Fetch all requests
        const { data: requests, error } = await supabase
            .from('admin_requests')
            .select('*')
            .order('requested_at', { ascending: false });

        if (error) throw error;

        // 2. Extract unique user IDs
        const userIds = [...new Set(requests.map(r => r.user_id).filter(Boolean))];

        if (userIds.length > 0) {
            // 3. Fetch user details manually (to avoid ambiguous join issues)
            // Note: We use the service role key if available to bypass RLS, 
            // but here we rely on the owner's permission or just the authenticated client.
            // If the owner cannot see users due to RLS, this might return empty.
            // Assuming owner has access.
            const { data: users, error: usersError } = await supabase
                .from('users')
                .select(`
                    *,
                    company:companies(*)
                `)
                .in('id', userIds);

            if (usersError) {
                console.error('Error fetching users for admin requests:', usersError);
                // Continue without user details rather than failing completely
            } else {
                // 4. Map users to requests
                const userMap = {};
                users.forEach(u => userMap[u.id] = u);

                requests.forEach(r => {
                    r.user = userMap[r.user_id] || null;
                });
            }
        }

        res.json(requests);
    } catch (err) {
        console.error('Error listing requests:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// 4. Approve Request (Owner Only)
router.put('/requests/:id/approve', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const requestId = req.params.id;

        // Owner check
        if (req.user.role !== 'owner') {
            return res.status(403).json({ message: 'Access denied. Owner only.' });
        }

        // Use RPC for transactional approval
        const { data: newCompanyId, error: rpcError } = await supabase
            .rpc('approve_admin_request_rpc', {
                p_request_id: requestId,
                p_approver_id: req.user.id
            });

        if (rpcError) throw rpcError;

        // Fetch user email for notification
        const { data: request } = await supabase
            .from('admin_requests')
            .select('user_id, company_name, user:users(email, name)')
            .eq('id', requestId)
            .single();

        if (request && request.user && request.user.email) {
            const emailSubject = 'Your Admin Request has been Approved!';
            const emailBody = `
                <h1>Congratulations ${request.user.name || 'User'}!</h1>
                <p>Your request to become an admin for <strong>${request.company_name}</strong> has been approved.</p>
                <p>Your company has been created successfully.</p>
                <p>You can now log in, create projects, and add members to your team.</p>
                <br>
                <p>Best regards,<br>MatrixBIM Team</p>
            `;
            
            // Send email asynchronously
            sendEmail(request.user.email, emailSubject, 'Your Admin Request Approved', emailBody)
                .catch(err => console.error('Failed to send approval email:', err));
        }

        res.json({ message: 'Request approved and company created successfully', company_id: newCompanyId });

    } catch (err) {
        console.error('Error approving request:', err);
        res.status(500).json({ message: err.message || 'Server error' });
    }
});

// 5. Reject Request (Owner Only)
router.put('/requests/:id/reject', auth, async (req, res) => {
    try {
        const supabase = req.supabase;
        const requestId = req.params.id;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        // Owner check
        if (req.user.role !== 'owner') {
            return res.status(403).json({ message: 'Access denied. Owner only.' });
        }

        // Use RPC for rejection
        const { error: rpcError } = await supabase
            .rpc('reject_admin_request_rpc', {
                p_request_id: requestId,
                p_reason: reason
            });

        if (rpcError) throw rpcError;

        // Fetch user email for notification
        const { data: request } = await supabase
            .from('admin_requests')
            .select('user_id, company_name, user:users(email, name)')
            .eq('id', requestId)
            .single();

        if (request && request.user && request.user.email) {
            const emailSubject = 'Update on your Admin Request';
            const emailBody = `
                <h1>Hello ${request.user.name || 'User'},</h1>
                <p>We regret to inform you that your request to become an admin for <strong>${request.company_name}</strong> has been rejected.</p>
                <p><strong>Reason:</strong> ${reason}</p>
                <p>You may edit your application and resubmit it for review.</p>
                <br>
                <p>Best regards,<br>MatrixBIM Team</p>
            `;
            
            // Send email asynchronously
            sendEmail(request.user.email, emailSubject, 'Your Admin Request Rejected', emailBody)
                .catch(err => console.error('Failed to send rejection email:', err));
        }

        res.json({ message: 'Request rejected successfully' });

    } catch (err) {
        console.error('Error rejecting request:', err);
        res.status(500).json({ message: err.message || 'Server error' });
    }
});

module.exports = router;
