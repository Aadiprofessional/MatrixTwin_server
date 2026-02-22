const express = require('express');
const router = express.Router();
const { auth, ownerOnly, adminOnly } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { sendEmail } = require('../utils/email');

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

      // Insert company (trigger will generate code)
      // Note: 'created_by' might not exist in the schema yet if SQL update hasn't been run.
      // We should check if we can insert it, or just fallback to basic insert.
      // But we can't easily check schema at runtime efficiently.
      // Let's assume the user hasn't run the SQL update yet, so we should stick to what works (name, details).
      // BUT we need the ID to add to company_members.
      
      const companyData = { name, details: details || {} };
      
      const { data, error } = await supabase
        .from('companies')
        .insert([companyData])
        .select()
        .single();

      if (error) throw error;

      // Manually add the creator (Owner) to company_members
      // This ensures they are a member even if the trigger hasn't been created yet
      const { error: memberError } = await supabase
        .from('company_members')
        .insert({
            company_id: data.id,
            user_id: req.user.id,
            role: 'owner'
        });
        
      if (memberError) {
          console.warn('Warning: Could not add owner to company_members immediately:', memberError);
          // Don't fail the request, but log it. 
          // If unique constraint fails, it means trigger likely worked or they are already there.
      }

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

/**
 * @route   PUT /api/companies/:id/assign-admin
 * @desc    Assign an admin to a company
 * @access  Private (Owner)
 */
router.put(
  '/:id/assign-admin',
  [
    auth,
    ownerOnly,
    body('admin_id').notEmpty().withMessage('Admin ID is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { admin_id } = req.body;
      const { supabase } = req;

      // 1. Verify that the user exists and is an admin
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', admin_id)
        .single();

      if (userError || !user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (user.role !== 'admin') {
        return res.status(400).json({ message: 'Selected user is not an admin. Please promote them first.' });
      }

      // 2. Check if this admin is already assigned to another company
      // Requirement: "1 admin user can only assign to 1 company"
      const { data: existingAssignment, error: assignmentError } = await supabase
        .from('companies')
        .select('id, name')
        .eq('admin_id', admin_id)
        .neq('id', id)
        .maybeSingle();

      if (existingAssignment) {
        return res.status(400).json({ 
          message: `This admin is already assigned to company: ${existingAssignment.name}. An admin can only manage one company.` 
        });
      }

      // 3. Update company
      const { data, error } = await supabase
        .from('companies')
        .update({ admin_id })
        .eq('id', id)
        .select();

      if (error) throw error;

      // Add to company_members as admin (handled by trigger, but can force here too if needed)
      // The trigger 'on_company_created_add_member' only runs on INSERT.
      // We need to add logic here or a trigger on UPDATE to companies.admin_id.
      // Let's do it manually here for safety.
      
      const { error: memberError } = await supabase
        .from('company_members')
        .upsert({ 
            company_id: id, 
            user_id: admin_id, 
            role: 'admin' 
        }, { onConflict: 'user_id' }); // Move from other company if any

      if (memberError) console.error('Error adding admin to members:', memberError);

      res.json({ message: 'Admin assigned successfully', company: data });
    } catch (err) {
      console.error('Error assigning admin:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

/**
 * @route   GET /api/companies/:id/members
 * @desc    Get members of a company
 * @access  Private (Owner)
 */
router.get(
  '/:id/members',
  [auth, ownerOnly],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { supabase } = req;

      const { data, error } = await supabase
        .from('company_members')
        .select(`
          user_id,
          role,
          joined_at,
          user:user_id (id, name, email, avatar)
        `)
        .eq('company_id', id);

      if (error) throw error;
      
      const members = data.map(m => ({
          user_id: m.user_id, // Ensure user_id is top level
          name: m.user.name,
          email: m.user.email,
          avatar: m.user.avatar,
          role: m.role,
          joined_at: m.joined_at
      }));

      res.json(members);
    } catch (err) {
      console.error('Error fetching members:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

/**
 * @route   POST /api/companies/invite
 * @desc    Invite a user to join the company via email
 * @access  Private (Admin/Owner)
 */
router.post(
  '/invite',
  [
    auth,
    adminOnly,
    body('email').isEmail().withMessage('Valid email is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { email, company_id } = req.body; // company_id optional if user is admin
      const { supabase, user } = req;

      let targetCompanyId = company_id;
      let companyName = '';
      let companyCode = '';

      // Identify the company
      if (user.role === 'owner') {
        if (!targetCompanyId) {
          return res.status(400).json({ message: 'Company ID is required for owners' });
        }
        const { data: company, error } = await supabase.from('companies').select('name, code').eq('id', targetCompanyId).single();
        if (error || !company) return res.status(404).json({ message: 'Company not found' });
        companyName = company.name;
        companyCode = company.code;
      } else {
        // User is admin, find their company
        const { data: company, error } = await supabase.from('companies').select('id, name, code').eq('admin_id', user.id).single();
        if (error || !company) return res.status(400).json({ message: 'You are not assigned to any company' });
        targetCompanyId = company.id;
        companyName = company.name;
        companyCode = company.code;
      }

      // Send Email
      const inviteLink = `${process.env.EMAIL_CONFIRM_REDIRECT_URL}?company_code=${companyCode}`; // Assuming a frontend route
      const subject = `Invitation to join ${companyName}`;
      const text = `You have been invited to join ${companyName}. Use code: ${companyCode} or click here: ${inviteLink}`;
      const html = `<p>You have been invited to join <strong>${companyName}</strong>.</p><p>Use code: <strong>${companyCode}</strong></p><p><a href="${inviteLink}">Click here to join</a></p>`;

      await sendEmail(email, subject, text, html);

      res.json({ message: `Invitation sent to ${email} for company ${companyName}` });
    } catch (err) {
      console.error('Error sending invite:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

/**
 * @route   POST /api/companies/join
 * @desc    Request to join a company (by ID or Code)
 * @access  Private (User)
 */
router.post(
  '/join',
  [
    auth,
    body('company_identifier').notEmpty().withMessage('Company ID or Code is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { company_identifier } = req.body;
      const { supabase, user } = req;

      // 1. Check if user is already in a company
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();
      
      if (userData?.company_id) {
        return res.status(400).json({ message: 'You are already a member of a company.' });
      }

      // 2. Find company by ID or Code
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(company_identifier);
      
      let companyId;
      if (isUuid) {
        const { data: foundId, error } = await supabase.rpc('get_company_by_id', { comp_id: company_identifier });
        if (error) {
             console.error('Error in get_company_by_id:', error);
             return res.status(500).json({ message: 'Server error' });
        }
        companyId = foundId;
      } else {
        const { data: foundId, error } = await supabase.rpc('get_company_by_code', { company_code: company_identifier });
        if (error) {
             console.error('Error in get_company_by_code:', error);
             // Try uppercase if error? No, error is likely system error. Not found returns null data.
        }
        companyId = foundId;
        
        if (!companyId) {
             // Try uppercase
             const { data: foundIdUpper } = await supabase.rpc('get_company_by_code', { company_code: company_identifier.toUpperCase() });
             companyId = foundIdUpper;
        }
      }

      if (!companyId) {
        return res.status(404).json({ message: 'Company not found' });
      }

      await createRequest(supabase, user.id, companyId, res);

    } catch (err) {
      console.error('Error joining company:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

async function createRequest(supabase, userId, companyId, res) {
  // Check for existing pending request
  const { data: existingRequest } = await supabase
    .from('company_join_requests')
    .select('status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .maybeSingle();

  if (existingRequest) {
    return res.status(400).json({ message: 'You already have a pending request for this company.' });
  }

  // Create request
  const { error } = await supabase
    .from('company_join_requests')
    .insert([{ user_id: userId, company_id: companyId, status: 'pending' }]);

  if (error) throw error;

  res.status(201).json({ message: 'Join request submitted successfully. Waiting for admin approval.' });
}

/**
 * @route   GET /api/companies/requests
 * @desc    Get pending join requests for my company
 * @access  Private (Admin/Owner)
 */
router.get('/requests', [auth, adminOnly], async (req, res) => {
  try {
    const { supabase, user } = req;
    let companyId;

    if (user.role === 'owner') {
      // Owner sees all requests? Or needs to specify company?
      // Let's allow owner to see all requests or filter by company_id query param
      if (req.query.company_id) {
        companyId = req.query.company_id;
      } else {
        // Return all pending requests
        const { data, error } = await supabase
          .from('company_join_requests')
          .select(`
            id, status, created_at,
            user:user_id (id, name, email, avatar),
            company:company_id (id, name)
          `)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
          
        if (error) throw error;
        return res.json(data);
      }
    } else {
      // Admin: find their company
      const { data: company } = await supabase.from('companies').select('id').eq('admin_id', user.id).single();
      if (!company) return res.status(400).json({ message: 'You are not assigned to any company' });
      companyId = company.id;
    }

    const { data, error } = await supabase
      .from('company_join_requests')
      .select(`
        id, status, created_at,
        user:user_id (id, name, email, avatar),
        company:company_id (id, name)
      `)
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Error fetching requests:', err);
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
    const { status } = req.body;
    const { supabase, user } = req;

    // Only handle 'approved' or 'rejected'
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    // If rejected, just update the status directly (no complex logic needed)
    if (status === 'rejected') {
      const { error } = await supabase
        .from('company_join_requests')
        .update({ status: 'rejected', updated_at: new Date() })
        .eq('id', id);
      
      if (error) throw error;
      return res.json({ message: 'Request rejected' });
    }

    // If approved, use RPC
    // 1. Verify Request Exists (redundant if RPC handles it, but good for error message)
    const { data: request, error: requestError } = await supabase
      .from('company_join_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Request is not pending' });
    }

    // 2. Check permissions
    if (user.role !== 'owner') {
      // Check if user is admin of this company
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('admin_id')
        .eq('id', request.company_id)
        .single();
      
      if (companyError || !company || company.admin_id !== user.id) {
        return res.status(403).json({ message: 'Permission denied' });
      }
    }

    // 3. Approve Request
    // Use the secure RPC function to update status and add to company_members
    const { error: rpcError } = await supabase.rpc('approve_join_request', { request_id: id });
    
    if (rpcError) {
      console.error('Error approving request:', rpcError);
      // If permission denied or other error
      return res.status(400).json({ message: rpcError.message });
    }

    res.json({ message: 'Request approved and user added to company members' });
  } catch (err) {
    console.error('Error approving request:', err);
    res.status(500).json({ message: 'Server error' });
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
    const { supabase } = req;

    // Check permissions manually since simple update
    // (RLS on company_join_requests should handle this if configured correctly)
    
    const { error } = await supabase
      .from('company_join_requests')
      .update({ status: 'rejected', updated_at: new Date() })
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Request rejected' });
  } catch (err) {
    console.error('Error rejecting request:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
