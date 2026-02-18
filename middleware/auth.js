const jwt = require('jsonwebtoken');

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
    next();
  } catch (err) {
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
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }
  next();
};

module.exports = { auth, checkRole, adminOnly }; 