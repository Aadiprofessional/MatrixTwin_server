const express = require('express');
const router = express.Router();
const { sendEmail } = require('../utils/email');

// Send email endpoint
router.post('/send', async (req, res) => {
    try {
        const { email, text, subject } = req.body;

        // Validate required fields
        if (!email || !text) {
            return res.status(400).json({ 
                error: 'Missing required fields. Email and text are required.' 
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                error: 'Invalid email format' 
            });
        }

        // Send email using SMTP
        const info = await sendEmail(
            email,
            subject || 'Message from MatrixTwin',
            text,
            `<p>${text.replace(/\n/g, '<br>')}</p>`
        );

        res.status(200).json({
            success: true,
            message: 'Email sent successfully',
            emailId: info.messageId,
            sentTo: email
        });

    } catch (error) {
        console.error('Email sending error:', error);
        res.status(500).json({ 
            error: 'Failed to send email',
            details: error.message 
        });
    }
});

// Health check endpoint for email service
router.get('/health', (req, res) => {
    res.status(200).json({
        service: 'Email Service',
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

module.exports = router; 
