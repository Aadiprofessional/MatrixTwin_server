const express = require('express');
const router = express.Router();
const { auth, ownerOnly, adminOnly } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { sendEmail } = require('../utils/email');
const { createSupabaseClient } = require('../supabase-client');

// --- 1. Join Request APIs ---

/**
 * @route   POST /api/companies/join
 * @desc    Request to join a company (User Only)
 * @access  Private (User)
 */
router.post(
  '/join',
  [
    auth,
    body('company_id').notEmpty().withMessage('Company ID is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { company_id } = req.body;
      const { supabase, user } = req;

      // 1. Check if user role is 'user'
    if (user.role !== 'user') {
      return res.status(403).json({ message: 'Only users can join companies' });
    }

    // 2. Check if user is already in a company (via users table or company_members)
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();
      
      if (userData?.company_id) {
        return res.status(400).json({ message: 'You are already a member of a company.' });
      }

      // 2. Check for existing pending request
      const { data: existingRequest } = await supabase
        .from('company_join_requests')
        .select('status')
        .eq('user_id', user.id)
        .eq('company_id', company_id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingRequest) {
        return res.status(400).json({ message: 'You already have a pending request for this company.' });
      }

      // Use service role client if available to bypass RLS for insertion
      let dbClient = supabase;
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (serviceKey && supabaseUrl) {
          try {
              dbClient = createSupabaseClient(supabaseUrl, serviceKey);
          } catch (e) {
              console.warn('Failed to create service role client, falling back to user client:', e.message);
          }
      } else {
          console.warn('SUPABASE_SERVICE_ROLE_KEY not found. Using user client. RLS bypass may not work.');
      }

      // 3. Create Request
      const { data: request, error } = await dbClient
        .from('company_join_requests')
        .insert([{ user_id: user.id, company_id, status: 'pending' }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({ message: 'Join request submitted successfully', request });

    } catch (err) {
      console.error('Error joining company:', err);
      res.status(500).json({ message: 'Server error', error: err.message });
    }
  }
);

/**
 * @route   GET /api/companies/requests
 * @desc    List pending join requests
 * @access  Private (Admin/Owner)
 */
router.get('/requests', [auth, adminOnly], async (req, res) => {
  try {
    const { supabase, user } = req;
    let query = supabase
      .from('company_join_requests')
      .select(`
        id, status, created_at,
        user:user_id (id, name, email, avatar),
        company:company_id (id, name)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (user.role === 'owner') {
      // Owner sees all requests
    } else {
      // Admin sees only requests for their company
      // First get admin's company_id
      const { data: adminCompany } = await supabase
        .from('companies')
        .select('id')
        .eq('admin_id', user.id)
        .single();
      
      if (!adminCompany) {
        return res.status(400).json({ message: 'You are not an admin of any company' });
      }
      
      query = query.eq('company_id', adminCompany.id);
    }

    const { data: requests, error } = await query;
    if (error) throw error;

    res.json(requests);

  } catch (err) {
    console.error('Error listing requests:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/companies/requests/:id/approve
 * @desc    Approve a join request
 * @access  Private (Admin/Owner)
 */
router.put('/requests/:id/approve', [auth, adminOnly], async (req, res) => {
  try {
    const { id } = req.params;
    const { supabase, user } = req;

    // 1. Fetch Request to check permissions
    const { data: request, error: fetchError } = await supabase
      .from('company_join_requests')
      .select('*, company:company_id(admin_id)')
      .eq('id', id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // 2. Permission Check
    if (user.role !== 'owner') {
      // Admin must own the company
      if (request.company.admin_id !== user.id) {
        return res.status(403).json({ message: 'Access denied. Not your company.' });
      }
    }

    // 3. Approve using RPC
    const { error: rpcError } = await supabase.rpc('approve_company_join_request_rpc', {
      p_request_id: id,
      p_approver_id: user.id
    });

    if (rpcError) throw rpcError;

    res.json({ message: 'Request approved. User added to company.' });

  } catch (err) {
    console.error('Error approving request:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

/**
 * @route   PUT /api/companies/requests/:id/reject
 * @desc    Reject a join request
 * @access  Private (Admin/Owner)
 */
router.put('/requests/:id/reject', [auth, adminOnly], async (req, res) => {
  try {
    const { id } = req.params;
    const { supabase, user } = req;

    // 1. Fetch Request to check permissions
    const { data: request, error: fetchError } = await supabase
      .from('company_join_requests')
      .select('*, company:company_id(admin_id)')
      .eq('id', id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // 2. Permission Check
    if (user.role !== 'owner') {
      if (request.company.admin_id !== user.id) {
        return res.status(403).json({ message: 'Access denied. Not your company.' });
      }
    }

    // 3. Reject (Update status)
    const { error } = await supabase
      .from('company_join_requests')
      .update({ status: 'rejected', updated_at: new Date() })
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Request rejected.' });

  } catch (err) {
    console.error('Error rejecting request:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// --- 2. Member Management APIs ---

/**
 * @route   GET /api/companies/members
 * @desc    List company members
 * @access  Private (Admin/Owner)
 */
router.get('/members', [auth, adminOnly], async (req, res) => {
  try {
    const { supabase, user } = req;
    
    let query = supabase
      .from('company_members')
      .select(`
        id, role, joined_at,
        user:user_id (id, name, email, avatar, role),
        company:company_id (id, name)
      `)
      .order('joined_at', { ascending: false });

    if (user.role === 'owner') {
      // Owner sees all members (can optionally filter by company_id)
      if (req.query.company_id) {
        query = query.eq('company_id', req.query.company_id);
      }
    } else {
      // Admin sees only their company members
      const { data: adminCompany } = await supabase
        .from('companies')
        .select('id')
        .eq('admin_id', user.id)
        .single();
      
      if (!adminCompany) {
        return res.status(400).json({ message: 'You are not an admin of any company' });
      }
      
      query = query.eq('company_id', adminCompany.id);
    }

    const { data: members, error } = await query;
    if (error) throw error;

    res.json(members);

  } catch (err) {
    console.error('Error listing members:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/companies/members/:user_id
 * @desc    Remove a member from company
 * @access  Private (Admin/Owner)
 */
router.delete('/members/:user_id', [auth, adminOnly], async (req, res) => {
  try {
    const { user_id } = req.params; // The user to remove
    const { supabase, user } = req; // The actor (Admin/Owner)

    // 1. Determine Company ID
    let targetCompanyId;

    if (user.role === 'owner') {
        // Owner can remove anyone, but we need to know WHICH company they are being removed from.
        // Or we just find which company the user belongs to.
        const { data: memberRecord, error: memberError } = await supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', user_id)
            .single();
        
        if (memberError || !memberRecord) {
            return res.status(404).json({ message: 'Member not found in any company' });
        }
        targetCompanyId = memberRecord.company_id;
    } else {
        // Admin: Can only remove from their company
        const { data: adminCompany } = await supabase
            .from('companies')
            .select('id')
            .eq('admin_id', user.id)
            .single();
        
        if (!adminCompany) {
            return res.status(403).json({ message: 'You are not an admin of any company' });
        }
        targetCompanyId = adminCompany.id;

        // Verify user is actually in this company
        const { data: isMember } = await supabase
            .from('company_members')
            .select('id')
            .eq('company_id', targetCompanyId)
            .eq('user_id', user_id)
            .maybeSingle();
        
        if (!isMember) {
            return res.status(404).json({ message: 'User is not a member of your company' });
        }
    }

    // 2. Prevent removing self (Admin removing self)
    if (user_id === user.id) {
        return res.status(400).json({ message: 'You cannot remove yourself.' });
    }
    
    // 3. Prevent removing the Company Owner (if applicable) or Admin?
    // Let's assume Owner can remove Admin, Admin can remove Members.
    // Check role of target user?
    // For now, simple removal.

    // 4. Remove using RPC
    const { error: rpcError } = await supabase.rpc('remove_company_member_rpc', {
      p_user_id: user_id,
      p_company_id: targetCompanyId
    });

    if (rpcError) throw rpcError;

    res.json({ message: 'Member removed successfully' });

  } catch (err) {
    console.error('Error removing member:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// --- 3. Company Management APIs (Existing/Updated) ---

/**
 * @route   POST /api/companies
 * @desc    Create a new company
 * @access  Private (Owner)
 */
router.post(
  '/',
  [
    auth,
    ownerOnly,
    body('name').notEmpty().withMessage('Company name is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name, details } = req.body;
      const { supabase } = req;
      
      const companyData = { name, details: details || {} };
      
      const { data, error } = await supabase
        .from('companies')
        .insert([companyData])
        .select()
        .single();

      if (error) throw error;

      // Add owner as member
      await supabase
        .from('company_members')
        .insert({
            company_id: data.id,
            user_id: req.user.id,
            role: 'owner'
        });

      // Update owner's company_id in users table
      await supabase
        .from('users')
        .update({ company_id: data.id })
        .eq('id', req.user.id);

      res.status(201).json({ message: 'Company created successfully', company: data });
    } catch (err) {
      console.error('Error creating company:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

/**
 * @route   GET /api/companies
 * @desc    Get all companies
 * @access  Private (Owner)
 */
router.get('/', [auth, ownerOnly], async (req, res) => {
  try {
    const { supabase } = req;

    const { data, error } = await supabase
      .from('companies')
      .select(`
        *,
        admin:admin_id (id, name, email, avatar)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Error fetching companies:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
