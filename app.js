require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { createSupabaseClient } = require('./supabase-client');

// Import all route modules
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const formRoutes = require('./routes/forms');
const customFormRoutes = require('./routes/customForms');
const bimfaceRoutes = require('./routes/bimface');
const dashscopeRoutes = require('./routes/dashscope');
const emailRoutes = require('./routes/email');
const diaryRoutes = require('./routes/diary');
const notificationRoutes = require('./routes/notifications');
const templateRoutes = require('./routes/template');
const smartlockRoutes = require('./routes/smartlock');
const cleansingRoutes = require('./routes/cleansing');
const labourRoutes = require('./routes/labour');
const safetyRoutes = require('./routes/safety');
const inspectionRoutes = require('./routes/inspection');
const surveyRoutes = require('./routes/survey');
const adminRoutes = require('./routes/admin');
const companyRoutes = require('./routes/companies');
const adminRequestRoutes = require('./routes/adminRequests');
const globalFormRoutes = require('./routes/global-forms');
const userUploadRoutes = require('./routes/user-uploads');
const aiHtmlRoutes = require('./routes/aiHtmlRoutes');

const app = express();

// Middleware setup - CORS configured
app.use(cors({
  origin: true, // Reflects the request origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'apikey', 'x-client-info', 'x-auth-token', 'auth-token', 'dev-user-id', 'dev-role', 'dev-skip-auth'],
  credentials: true
}));

// Fallback Manual CORS headers (in case cors middleware misses something or for specific serverless environments)
app.use((req, res, next) => {
  // If headers are already sent by cors middleware, don't overwrite
  if (res.headersSent) return next();

  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, apikey, x-client-info, x-auth-token, auth-token, dev-user-id, dev-role, dev-skip-auth');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Enable express body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Add logging in development
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Supabase client middleware
app.use((req, res, next) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    
    // Use service role key for database operations to bypass RLS
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase URL or Key');
      // We don't throw here to allow health checks to pass, but downstream usage will fail
    } else {
      console.log('Supabase client configuration:', {
        url: supabaseUrl,
        keyType: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE' : 'ANON'
      });
      
      req.supabase = createSupabaseClient(supabaseUrl, supabaseKey);
      console.log('Supabase client created successfully');
    }
    next();
  } catch (error) {
    console.error('Supabase client error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'BuildSphere API is running on Alibaba Cloud',
    version: '1.0.0',
    platform: 'alibaba-cloud',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      projects: '/api/projects',
      forms: '/api/forms',
      customForms: '/api/custom-forms',
      bimface: '/api/bimface',
      dashscope: '/api/dashscope',
      email: '/api/email',
      diary: '/api/diary',
      notifications: '/api/notifications',
      templates: '/api/templates',
      smartlock: '/api/smartlock',
      cleansing: '/api/cleansing',
      labour: '/api/labour',
      safety: '/api/safety',
      inspection: '/api/inspection',
      survey: '/api/survey',
      admin: '/api/admin',
      companies: '/api/companies'
    }
  });
});

// Route setup
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/admin-requests', adminRequestRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/custom-forms', customFormRoutes);
app.use('/api/bimface', bimfaceRoutes);
app.use('/api/dashscope', dashscopeRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/diary', diaryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/smartlock', smartlockRoutes);
app.use('/api/cleansing', cleansingRoutes);
app.use('/api/labour', labourRoutes);
app.use('/api/safety', safetyRoutes);
app.use('/api/inspection', inspectionRoutes);
app.use('/api/survey', surveyRoutes);
app.use('/api/global-forms', globalFormRoutes);
app.use('/api/uploads', userUploadRoutes);
app.use('/api/ai-html', aiHtmlRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    method: req.method,
    availableEndpoints: [
      '/api/auth',
      '/api/projects', 
      '/api/forms',
      '/api/custom-forms',
      '/api/bimface',
      '/api/dashscope',
      '/api/email',
      '/api/diary',
      '/api/notifications',
      '/api/templates',
      '/api/smartlock',
      '/api/cleansing',
      '/api/labour',
      '/api/safety',
      '/api/inspection',
      '/api/survey'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start server only if run directly (not in serverless)
if (require.main === module) {
  const PORT = process.env.PORT || 6789;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
