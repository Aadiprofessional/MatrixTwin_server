const jwt = require('jsonwebtoken');

const { createSupabaseClient } = require('../supabase-client');

/**
 * Authentication middleware
 * Verifies JWT token in the Authorization header
 * Sets req.user with decoded token payload
 */
const auth = (req, res, next) => {
  // Skip auth in development mode with dev-skip-auth header
  if (process.env.NODE_ENV === 'development' && req.headers['dev-skip-auth'] === 'true') {
    req.user = {
      id: 'dev-user-id',
      role: req.headers['dev-role'] || 'admin'
    };
    console.log('Auth bypassed in development mode:', req.user);
    return next();
  }

  // Get token from header
  const token = req.header('Authorization')?.replace('Bearer ', '');

  // Check if no token
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jwtsecrettoken');
    
    // Add user info to request
    req.user = decoded;

    // IMPORTANT: Re-initialize Supabase client with the SUPABASE token (not our JWT)
    // This ensures RLS policies work correctly using auth.uid()
    // We only do this if we have the Supabase token in our payload
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && decoded.sb_token) {
      const supabaseUrl = process.env.SUPABASE_URL || 'https://supabase.matrixaiserver.com';
      const supabaseKey = process.env.SUPABASE_ANON_KEY;
      
      req.supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
        global: {
          headers: {
            Authorization: `Bearer ${decoded.sb_token}`
          }
        }
      });
    }

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

/**
 * Role check middleware
 * Checks if user has one of the required roles
 * Must be used after auth middleware
 */
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied, insufficient permissions' });
    }
    
    next();
  };
};

// Middleware to check if user is admin
const adminOnly = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'owner')) {
    return res.status(403).json({ message: 'Access denied. Admin or Owner only.' });
  }
  next();
};

// Middleware to check if user is owner
const ownerOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Access denied. Owner only.' });
  }
  next();
};

module.exports = { auth, checkRole, adminOnly, ownerOnly }; 