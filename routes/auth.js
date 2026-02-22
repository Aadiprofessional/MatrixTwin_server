const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { auth, adminOnly } = require('../middleware/auth');

// Simple in-memory rate limiter for password reset
const passwordResetAttempts = {};
const RESET_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

// Define valid roles - keeping for backward compatibility but will be dynamic
const VALID_ROLES = {
  ADMIN: 'admin',
  PROJECT_MANAGER: 'projectManager',
  SITE_INSPECTOR: 'siteInspector',
  CONTRACTOR: 'contractor',
  WORKER: 'worker'
};

// Default role for new signups - will be 'user' if no roles exist
const DEFAULT_ROLE = 'user';

// Clear expired entries periodically
setInterval(() => {
  const now = Date.now();
  Object.keys(passwordResetAttempts).forEach(email => {
    if (now - passwordResetAttempts[email] > RESET_TIMEOUT_MS) {
      delete passwordResetAttempts[email];
    }
  });
}, 15 * 60 * 1000); // Clean up every 15 minutes

// Development-only route for getting test tokens
if (process.env.NODE_ENV === 'development') {
  router.get('/dev-token/:role/:id?', (req, res) => {
    const { role, id } = req.params;
    const validRoles = ['admin', 'projectManager', 'siteInspector', 'contractor', 'worker', 'owner', 'member'];
    
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    
    const userId = id || 'test-user-id';
    
    const token = jwt.sign(
      { id: userId, role },
      process.env.JWT_SECRET || 'jwtsecrettoken',
      { expiresIn: '1d' }
    );
    
    res.json({ token, userId, role });
  });
}

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user
 * @access  Public
 */
router.post(
  '/signup',
  [
    body('name').not().isEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('company_code').optional().isString().withMessage('Company code must be a string'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, company_code } = req.body;
    const { supabase } = req;
    
    console.log('Signup Request:', { name, email, company_code });

    try {
      // Check company code first if provided
      let companyId = null;
      if (company_code) {
        console.log(`Checking company code: "${company_code}" (Upper: "${company_code.toUpperCase()}")`);
        
        // Use RPC to bypass RLS since unauthenticated users cannot select from companies table
        const { data: foundId, error: rpcError } = await supabase.rpc('get_company_by_code', { 
            company_code: company_code.toUpperCase().trim() 
        });

        if (rpcError) {
            console.error('Error calling get_company_by_code RPC:', rpcError);
            // Fallback to direct query if RPC fails (e.g. not created yet), but this will fail if RLS is on
            const { data: company, error: companyError } = await supabase
              .from('companies')
              .select('id')
              .eq('code', company_code.toUpperCase())
              .maybeSingle();
            
            if (companyError) {
                 console.error('Error checking company code directly:', companyError);
                 return res.status(400).json({ message: 'Error validating company code' });
            }
            if (company) companyId = company.id;
        } else {
            companyId = foundId;
        }
        
        if (!companyId) {
            return res.status(400).json({ message: 'Invalid Company Code' });
        }
      }

      // Sign up user using Supabase Auth
      // Note: We rely on a Postgres Trigger to create the record in public.users table
      // This is safer and ensures consistency without needing Service Role keys on the client
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: process.env.EMAIL_CONFIRM_REDIRECT_URL,
          data: {
            name,
            role: DEFAULT_ROLE,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0062C3&color=fff`
          }
        }
      });

      if (authError) {
        console.error('Supabase Auth Error:', JSON.stringify(authError));
        return res.status(400).json({ message: authError.message || 'Signup failed' });
      }

      if (authData.user) {
        // If company code was provided, create a join request
        if (companyId) {
            try {
                // We use a scoped client if the user is authenticated (session available)
                // If not, we fall back to RPC or simply fail gracefully (user confirms email first)
                if (authData.session) {
                    const userClient = createClient(
                        process.env.SUPABASE_URL,
                        process.env.SUPABASE_ANON_KEY,
                        {
                            global: {
                                headers: {
                                    Authorization: `Bearer ${authData.session.access_token}`
                                }
                            }
                        }
                    );
                    
                    const { error: joinError } = await userClient
                        .from('company_join_requests')
                        .insert({
                            company_id: companyId,
                            user_id: authData.user.id,
                            status: 'pending'
                        });
                    
                    if (joinError) {
                        console.error('Error creating join request with user session:', joinError);
                    } else {
                        console.log('Join request created successfully for user:', authData.user.id);
                    }
                } else {
                    // Try using RPC if no session (e.g. email confirm required)
                    // Note: RPC must be SECURITY DEFINER to bypass RLS
                    const { error: rpcJoinError } = await supabase.rpc('create_join_request_by_code', {
                        company_code: company_code.toUpperCase().trim(),
                        p_user_id: authData.user.id
                    });
                    
                    if (rpcJoinError) {
                        console.error('Error creating join request via RPC (User not logged in yet):', rpcJoinError);
                        // This is expected if the RPC doesn't exist or permissions block it.
                        // The user can request to join later manually.
                    } else {
                         console.log('Join request created via RPC for user:', authData.user.id);
                    }
                }
            } catch (joinErr) {
                console.error('Exception creating join request:', joinErr);
            }
        }

        // Create JWT with user data
        const token = jwt.sign(
          { 
            id: authData.user.id, 
            role: DEFAULT_ROLE,
            sb_token: authData.session?.access_token // Store Supabase access token if available
          },
          process.env.JWT_SECRET || 'jwtsecrettoken',
          { expiresIn: '1d' }
        );

        res.status(201).json({
          token,
          user: {
            id: authData.user.id,
            name,
            email,
            role: DEFAULT_ROLE,
            avatar: authData.user.user_metadata?.avatar
          }
        });
      } else {
        res.status(200).json({
          message: 'Please check your email to confirm your registration'
        });
      }
    } catch (err) {
      console.error('Signup error:', err);
      res.status(500).json({ 
        message: 'Server error', 
        details: process.env.NODE_ENV === 'development' ? err.message : undefined 
      });
    }
  }
);

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user & get token
 * @access  Public
 */
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').exists().withMessage('Password is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const { supabase } = req;

    try {
      // Sign in using Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        console.error('Auth Error:', authError);
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      if (!authData?.user?.id) {
        return res.status(400).json({ message: 'Authentication failed' });
      }

      // Get user data directly
      // Note: We're selecting from public.users which should be populated by the trigger
      // If the trigger failed or is slow, this might return null, so we should handle that
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, name, email, role, avatar')
        .eq('id', authData.user.id)
        .single();

      if (userError) {
        console.error('User data fetch error:', userError);
        // Fallback if public user record doesn't exist yet (rare race condition or trigger failure)
        // We can just return basic auth data
      }

      // Create JWT
      const token = jwt.sign(
        { 
          id: authData.user.id, 
          role: userData?.role || 'user',
          sb_token: authData.session.access_token // Store Supabase access token
        },
        process.env.JWT_SECRET || 'jwtsecrettoken',
        { expiresIn: '1d' }
      );

      res.json({
        token,
        user: userData || {
          id: authData.user.id,
          email: authData.user.email,
          role: 'user',
          avatar: authData.user.user_metadata?.avatar
        }
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ 
        message: 'Server error',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

/**
 * @route   POST /api/auth/verify-2fa
 * @desc    Verify two-factor authentication code
 * @access  Public
 */
router.post(
  '/verify-2fa',
  [
    body('code').isLength({ min: 6, max: 6 }).withMessage('Valid 6-digit code is required'),
    body('email').isEmail().withMessage('Email is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // In a real app, we would validate the 2FA code
    // For demo purposes, we'll just accept any 6-digit code
    res.json({ success: true });
  }
);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset email
 * @access  Public
 */
router.post(
  '/forgot-password',
  [
    body('email').isEmail().withMessage('Please include a valid email')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;
    const { supabase } = req;

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: process.env.PASSWORD_RESET_REDIRECT_URL || 'http://localhost:3000/reset-password'
      });

      if (error) {
        console.error('Password reset error:', error);
        // Don't reveal if user exists
        return res.json({ message: 'If an account exists, a password reset link will be sent' });
      }

      res.json({ message: 'If an account exists, a password reset link will be sent' });
    } catch (err) {
      console.error('Forgot password error:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post(
  '/reset-password',
  [
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { password } = req.body;
    const { supabase } = req;

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) throw error;

      res.json({ message: 'Password updated successfully' });
    } catch (err) {
      console.error('Reset password error:', err);
      res.status(500).json({ message: 'Password reset failed' });
    }
  }
);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get('/me', auth, async (req, res) => {
  try {
    const { supabase } = req;
    
    // Get user data from Supabase Auth
    const { data: authUser, error: authError } = await supabase.auth.getUser();
    
    if (authError || !authUser.user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Get additional user data from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, name, email, role, avatar')
      .eq('id', req.user.id)
      .single();
      
    if (userError) {
      return res.status(500).json({ message: 'Error fetching user profile' });
    }
    
    res.json(userData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Sign out user
 * @access  Private
 */
router.post('/logout', auth, async (req, res) => {
  try {
    const { supabase } = req;
    
    // Sign out user using Supabase Auth
    const { error } = await supabase.auth.signOut();
    
    if (error) throw error;
    
    res.json({ message: 'Successfully logged out' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/auth/users
 * @desc    Get all users (Admin only)
 * @access  Private/Admin
 */
router.get('/users', [auth, adminOnly], async (req, res) => {
  try {
    const { supabase } = req;
    
    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, email, role, avatar')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/auth/users/:uid
 * @desc    Get all users with their project assignments
 * @access  Private/Admin
 */
router.get('/users/:uid', async (req, res) => {
  try {
    const requestingUserId = req.params.uid;
    
    // First check the requesting user's role
    const { data: requestingUser, error: roleError } = await req.supabase
      .from('users')
      .select('role')
      .eq('id', requestingUserId)
      .single();

    if (roleError || !requestingUser) {
      return res.status(404).json({ error: 'Requesting user not found' });
    }

    // First get users based on role
    let userQuery = req.supabase
      .from('users')
      .select('id, name, email, role, avatar');

    // Apply role-based filtering
    if (requestingUser.role === 'admin') {
      // Admin can see all users
    } else if (['projectManager', 'contractor'].includes(requestingUser.role)) {
      // Project managers and contractors can only see workers
      userQuery = userQuery.eq('role', 'worker');
    } else {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { data: users, error: userError } = await userQuery.order('created_at', { ascending: false });

    if (userError) throw userError;

    // Now get project assignments for these users
    const userIds = users.map(user => user.id);
    const { data: assignments, error: assignmentError } = await req.supabase
      .from('project_assignments')
      .select(`
        user_id,
        project_id,
        projects (*)
      `)
      .in('user_id', userIds);

    if (assignmentError) throw assignmentError;

    // Map assignments to users
    const formattedUsers = users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      assigned_projects: assignments
        ? assignments
            .filter(assignment => assignment.user_id === user.id)
            .map(assignment => assignment.projects)
        : []
    }));

    res.json(formattedUsers);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/auth/users/:userId/role
 * @desc    Update user role (Admin only) - Legacy endpoint, use role-dynamic instead
 * @access  Private/Admin
 */
router.put(
  '/users/:userId/role',
  [
    auth,
    adminOnly,
    body('role').notEmpty().withMessage('Role is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { userId } = req.params;
      const { role } = req.body;
      const { supabase } = req;

      // Check if the role exists in the roles table
      const { data: roleExists, error: roleError } = await supabase
        .from('roles')
        .select('id, name')
        .eq('name', role)
        .single();

      if (roleError || !roleExists) {
        return res.status(400).json({ message: 'Role does not exist. Please create the role first or use existing roles.' });
      }

      // Update user role
      const { data, error } = await supabase
        .from('users')
        .update({ role })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      res.json(data);
    } catch (err) {
      console.error('Error updating user role:', err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

/**
 * @route   DELETE /api/auth/users/:userId
 * @desc    Delete a user (Admin only)
 * @access  Private/Admin
 */
router.delete('/users/:userId', [auth, adminOnly], async (req, res) => {
  try {
    const { userId } = req.params;
    const { supabase } = req;

    // First delete from Supabase Auth
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) throw authError;

    // Then delete from our users table
    const { error: dbError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (dbError) throw dbError;

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PATCH /api/auth/users/role
 * @desc    Update user role - Legacy endpoint, use role-dynamic instead
 * @access  Private/Admin
 */
router.patch('/users/role', async (req, res) => {
  try {
    const { admin_uid, user_id, new_role } = req.body;

    if (!admin_uid || !user_id || !new_role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if the requesting user is an admin
    const { data: adminUser, error: adminError } = await req.supabase
      .from('users')
      .select('role')
      .eq('id', admin_uid)
      .single();

    if (adminError || !adminUser) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    if (adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update user roles' });
    }

    // Check if the role exists in the roles table
    const { data: roleExists, error: roleError } = await req.supabase
      .from('roles')
      .select('id, name')
      .eq('name', new_role)
      .single();

    if (roleError || !roleExists) {
      return res.status(400).json({ error: 'Role does not exist. Please create the role first.' });
    }

    // Update the user's role
    const { error: updateError } = await req.supabase
      .from('users')
      .update({ role: new_role })
      .eq('id', user_id);

    if (updateError) throw updateError;

    res.json({ message: 'User role updated successfully' });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/auth/roles/create
 * @desc    Create a new custom role with permissions (Admin only)
 * @access  Private/Admin
 */
router.post('/roles/create', async (req, res) => {
  try {
    const { admin_uid, role_name, description, permissions } = req.body;

    if (!admin_uid || !role_name) {
      return res.status(400).json({ error: 'Admin UID and role name are required' });
    }

    // Check if the requesting user is an admin
    const { data: adminUser, error: adminError } = await req.supabase
      .from('users')
      .select('role')
      .eq('id', admin_uid)
      .single();

    if (adminError || !adminUser) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    if (adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create roles' });
    }

    // Check if role already exists
    const { data: existingRole, error: roleCheckError } = await req.supabase
      .from('roles')
      .select('id')
      .eq('name', role_name)
      .single();

    if (existingRole) {
      return res.status(400).json({ error: 'Role already exists' });
    }

    // Create the new role
    const { data: newRole, error: roleError } = await req.supabase
      .from('roles')
      .insert([{
        name: role_name,
        description: description || `Custom role: ${role_name}`,
        created_by: admin_uid
      }])
      .select()
      .single();

    if (roleError) throw roleError;

    // If permissions are provided, add them to the role
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      const rolePermissions = permissions.map(perm => ({
        role_id: newRole.id,
        permission_id: perm.permission_id,
        permission_level: perm.level || 1
      }));

      const { error: permError } = await req.supabase
        .from('role_permissions')
        .insert(rolePermissions);

      if (permError) {
        console.error('Error adding permissions to role:', permError);
        // Don't fail the role creation, just log the error
      }
    }

    res.status(201).json({
      message: 'Role created successfully',
      role: newRole
    });
  } catch (err) {
    console.error('Error creating role:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/auth/roles
 * @desc    Get all available roles with their permissions
 * @access  Private
 */
router.get('/roles', async (req, res) => {
  try {
    // Get all roles
    const { data: roles, error: rolesError } = await req.supabase
      .from('roles')
      .select('*')
      .order('created_at', { ascending: true });

    if (rolesError) throw rolesError;

    // Get all permissions for each role
    const rolesWithPermissions = await Promise.all(
      roles.map(async (role) => {
        const { data: permissions, error: permError } = await req.supabase
          .from('role_permissions')
          .select(`
            permission_level,
            permissions (
              id,
              name,
              category,
              description
            )
          `)
          .eq('role_id', role.id);

        if (permError) {
          console.error('Error fetching permissions for role:', role.name, permError);
          return { ...role, permissions: [] };
        }

        return {
          ...role,
          permissions: permissions.map(p => ({
            ...p.permissions,
            level: p.permission_level
          }))
        };
      })
    );

    res.json(rolesWithPermissions);
  } catch (err) {
    console.error('Error fetching roles:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/auth/permissions
 * @desc    Get all available permissions
 * @access  Private
 */
router.get('/permissions', async (req, res) => {
  try {
    const { data: permissions, error } = await req.supabase
      .from('permissions')
      .select('*')
      .order('category', { ascending: true });

    if (error) throw error;

    // Group permissions by category
    const groupedPermissions = permissions.reduce((acc, perm) => {
      if (!acc[perm.category]) {
        acc[perm.category] = [];
      }
      acc[perm.category].push(perm);
      return acc;
    }, {});

    res.json(groupedPermissions);
  } catch (err) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/auth/roles/:roleId/permissions
 * @desc    Update permissions for a role (Admin only)
 * @access  Private/Admin
 */
router.put('/roles/:roleId/permissions', async (req, res) => {
  try {
    const { roleId } = req.params;
    const { admin_uid, permissions } = req.body;

    if (!admin_uid) {
      return res.status(400).json({ error: 'Admin UID is required' });
    }

    // Check if the requesting user is an admin
    const { data: adminUser, error: adminError } = await req.supabase
      .from('users')
      .select('role')
      .eq('id', admin_uid)
      .single();

    if (adminError || !adminUser) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    if (adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update role permissions' });
    }

    // First, delete existing permissions for this role
    const { error: deleteError } = await req.supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId);

    if (deleteError) throw deleteError;

    // Add new permissions if provided
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      const rolePermissions = permissions.map(perm => ({
        role_id: roleId,
        permission_id: perm.permission_id,
        permission_level: perm.level || 1
      }));

      const { error: insertError } = await req.supabase
        .from('role_permissions')
        .insert(rolePermissions);

      if (insertError) throw insertError;
    }

    res.json({ message: 'Role permissions updated successfully' });
  } catch (err) {
    console.error('Error updating role permissions:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PATCH /api/auth/users/role-dynamic
 * @desc    Update user role to any custom role (Admin only)
 * @access  Private/Admin
 */
router.patch('/users/role-dynamic', async (req, res) => {
  try {
    const { admin_uid, user_id, new_role } = req.body;

    if (!admin_uid || !user_id || !new_role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if the requesting user is an admin
    const { data: adminUser, error: adminError } = await req.supabase
      .from('users')
      .select('role')
      .eq('id', admin_uid)
      .single();

    if (adminError || !adminUser) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    if (adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can update user roles' });
    }

    // Check if the role exists in the roles table
    const { data: roleExists, error: roleError } = await req.supabase
      .from('roles')
      .select('id, name')
      .eq('name', new_role)
      .single();

    if (roleError || !roleExists) {
      return res.status(400).json({ error: 'Role does not exist' });
    }

    // Update the user's role
    const { error: updateError } = await req.supabase
      .from('users')
      .update({ role: new_role })
      .eq('id', user_id);

    if (updateError) throw updateError;

    res.json({ message: 'User role updated successfully' });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/auth/users/:userId/permissions
 * @desc    Get user's permissions based on their role
 * @access  Private
 */
router.get('/users/:userId/permissions', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user's role
    const { data: user, error: userError } = await req.supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get role permissions using the database function
    const { data: permissions, error: permError } = await req.supabase
      .rpc('get_user_permissions', { user_role: user.role });

    if (permError) throw permError;

    res.json({
      user_id: userId,
      role: user.role,
      permissions: permissions || []
    });
  } catch (err) {
    console.error('Error fetching user permissions:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/auth/roles/:roleId
 * @desc    Delete a custom role (Admin only)
 * @access  Private/Admin
 */
router.delete('/roles/:roleId', async (req, res) => {
  try {
    const { roleId } = req.params;
    const { admin_uid } = req.body;

    if (!admin_uid) {
      return res.status(400).json({ error: 'Admin UID is required' });
    }

    // Check if the requesting user is an admin
    const { data: adminUser, error: adminError } = await req.supabase
      .from('users')
      .select('role')
      .eq('id', admin_uid)
      .single();

    if (adminError || !adminUser) {
      return res.status(404).json({ error: 'Admin user not found' });
    }

    if (adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete roles' });
    }

    // Check if role exists and is not a default role
    const { data: role, error: roleError } = await req.supabase
      .from('roles')
      .select('name')
      .eq('id', roleId)
      .single();

    if (roleError || !role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Prevent deletion of default roles
    const defaultRoles = ['admin', 'projectManager', 'siteInspector', 'contractor', 'worker'];
    if (defaultRoles.includes(role.name)) {
      return res.status(400).json({ error: 'Cannot delete default system roles' });
    }

    // Check if any users have this role
    const { data: usersWithRole, error: usersError } = await req.supabase
      .from('users')
      .select('id')
      .eq('role', role.name)
      .limit(1);

    if (usersError) throw usersError;

    if (usersWithRole && usersWithRole.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete role that is assigned to users. Please reassign users first.' 
      });
    }

    // Delete the role (permissions will be deleted automatically due to CASCADE)
    const { error: deleteError } = await req.supabase
      .from('roles')
      .delete()
      .eq('id', roleId);

    if (deleteError) throw deleteError;

    res.json({ message: 'Role deleted successfully' });
  } catch (err) {
    console.error('Error deleting role:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 