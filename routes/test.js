const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    message: 'Test route is working!',
    time: new Date().toISOString()
  });
});

module.exports = router;
