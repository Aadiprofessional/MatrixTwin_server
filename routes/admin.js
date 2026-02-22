const express = require('express');
const router = express.Router();
const { auth, ownerOnly } = require('../middleware/auth');

/**
 * @route   POST /api/admin/request
 * @desc    Request to become an admin
 * @access  Private (User)
 */
router.post('/request', auth, async (req, res) => {
  try {
    const { supabase } = req;
    const userId = req.user.id;

    // Check if request already exists (pending OR approved)
    const { data: existingRequest, error: fetchError } = await supabase
      .from('admin_requests')
      .select('status')
      .eq('user_id', userId)
      .in('status', ['pending', 'approved'])
      .maybeSingle(); // Use maybeSingle to avoid error if no rows found

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return res.status(400).json({ message: 'You already have a pending request.' });
      }
      if (existingRequest.status === 'approved') {
        return res.status(400).json({ message: 'You are already an approved admin.' });
      }
    }

    // Create request
    const { data, error } = await supabase
      .from('admin_requests')
      .insert([{ user_id: userId, status: 'pending' }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Admin request submitted successfully', request: data });
  } catch (err) {
    console.error('Error submitting admin request:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/admin/requests
 * @desc    Get all admin requests (Owner only)
 * @access  Private (Owner)
 */
router.get('/requests', [auth, ownerOnly], async (req, res) => {
  try {
    const { supabase } = req;

    // Fetch requests with user details
    const { data, error } = await supabase
      .from('admin_requests')
      .select(`
        *,
        users:user_id (id, name, email, role, avatar)
      `)
      .order('requested_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Error fetching admin requests:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/admin/requests/:id/approve
 * @desc    Approve admin request (Owner only)
 * @access  Private (Owner)
 */
router.put('/requests/:id/approve', [auth, ownerOnly], async (req, res) => {
  try {
    const { id } = req.params;
    const { supabase } = req;

    // 1. Get the request to find the user_id
    const { data: request, error: fetchError } = await supabase
      .from('admin_requests')
      .select('user_id, status')
      .eq('id', id)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: `Request is already ${request.status}` });
    }

    // 2. Update request status
    const { error: updateRequestError } = await supabase
      .from('admin_requests')
      .update({ status: 'approved', updated_at: new Date() })
      .eq('id', id);

    if (updateRequestError) throw updateRequestError;

    // 3. Update user role to admin in public.users
    const { error: updateUserError } = await supabase
      .from('users')
      .update({ role: 'admin' })
      .eq('id', request.user_id);

    if (updateUserError) throw updateUserError;
    
    // 4. Update user role in Supabase Auth (optional but recommended for consistency)
    // Note: This requires service role key which we might not have in the client context if RLS is used.
    // However, if we are running as a user who is an owner, we might not have permissions to update auth.users directly unless we use a secure function or service key.
    // Since we are using a trigger to sync auth.users -> public.users, we should ideally sync back or just rely on public.users for role checks in our app.
    // Our middleware checks `req.user.role` which comes from `public.users` (via `auth` middleware logic in `routes/auth.js` -> `me` endpoint).
    // Let's check `middleware/auth.js`.
    // The `auth` middleware decodes the JWT. The JWT is created in `login` with the role from `public.users`.
    // So updating `public.users` is sufficient for our app's authorization.

    res.json({ message: 'User approved as admin successfully' });
  } catch (err) {
    console.error('Error approving admin request:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/admin/requests/:id/reject
 * @desc    Reject admin request (Owner only)
 * @access  Private (Owner)
 */
router.put('/requests/:id/reject', [auth, ownerOnly], async (req, res) => {
  try {
    const { id } = req.params;
    const { supabase } = req;

    const { error } = await supabase
      .from('admin_requests')
      .update({ status: 'rejected', updated_at: new Date() })
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Request rejected' });
  } catch (err) {
    console.error('Error rejecting admin request:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/admin/promote/:userId
 * @desc    Directly promote a user to admin (Owner only)
 * @access  Private (Owner)
 */
router.put('/promote/:userId', [auth, ownerOnly], async (req, res) => {
  try {
    const { userId } = req.params;
    const { supabase } = req;

    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ message: 'User is already an admin' });
    }

    if (user.role === 'owner') {
      return res.status(400).json({ message: 'Cannot promote an owner' });
    }

    // Update user role
    const { error: updateError } = await supabase
      .from('users')
      .update({ role: 'admin' })
      .eq('id', userId);

    if (updateError) throw updateError;

    // Also approve any pending requests for this user
    await supabase
      .from('admin_requests')
      .update({ status: 'approved', updated_at: new Date() })
      .eq('user_id', userId)
      .eq('status', 'pending');

    res.json({ message: 'User promoted to admin successfully' });
  } catch (err) {
    console.error('Error promoting user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/admin/demote/:userId
 * @desc    Demote an admin to regular user (Owner only)
 * @access  Private (Owner)
 */
router.put('/demote/:userId', [auth, ownerOnly], async (req, res) => {
  try {
    const { userId } = req.params;
    const { supabase } = req;

    // Check if user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role !== 'admin') {
      return res.status(400).json({ message: 'User is not an admin' });
    }

    // Update user role
    const { error: updateError } = await supabase
      .from('users')
      .update({ role: 'user' })
      .eq('id', userId);

    if (updateError) throw updateError;

    res.json({ message: 'Admin demoted to user successfully' });
  } catch (err) {
    console.error('Error demoting admin:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/admin/list
 * @desc    List all admins (Owner only)
 * @access  Private (Owner)
 */
router.get('/list', [auth, ownerOnly], async (req, res) => {
  try {
    const { supabase } = req;

    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, avatar, created_at')
      .eq('role', 'admin')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Error listing admins:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
