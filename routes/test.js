const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

router.get('/', (req, res) => {
  res.json({
    message: 'Test route is working!',
    time: new Date().toISOString()
  });
});

router.get('/protected', auth, (req, res) => {
  res.json({
    message: 'Protected route accessed successfully',
    user: req.user
  });
});

module.exports = router;
