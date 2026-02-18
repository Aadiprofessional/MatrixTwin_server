const express = require('express');
const router = express.Router();
const { Resend } = require('resend');

// Initialize Resend with API key
const resend = new Resend('re_CYa5oG13_ECrEJT5L42u1VydajXWK6W8s');

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

        // Send email using Resend
        const { data, error } = await resend.emails.send({
            from: 'MatrixTwin <noreply@matrixtwin.com>', // Default from address for testing
            to: [email],
            subject: subject || 'Message from MatrixTwin',
            text: text,
            html: `<p>${text.replace(/\n/g, '<br>')}</p>` // Convert line breaks to HTML
        });

        if (error) {
            console.error('Resend error:', error);
            return res.status(500).json({ 
                error: 'Failed to send email',
                details: error.message 
            });
        }

        res.status(200).json({
            success: true,
            message: 'Email sent successfully',
            emailId: data.id,
            sentTo: email
        });

    } catch (error) {
        console.error('Email sending error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
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