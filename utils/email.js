const nodemailer = require('nodemailer');

const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER || process.env.SMTP_ADMIN_EMAIL;
const smtpSenderName = process.env.SMTP_SENDER_NAME || 'MatrixAI Global';
const smtpFromEmail = process.env.SMTP_ADMIN_EMAIL || smtpUser;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: smtpUser,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} text - Email body (text)
 * @param {string} html - Email body (html)
 */
const sendEmail = async (to, subject, text, html) => {
  try {
    const info = await transporter.sendMail({
      from: `"${smtpSenderName}" <${smtpFromEmail}>`,
      to,
      subject,
      text,
      html,
    });
    console.log('Message sent: %s', info.messageId);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

module.exports = { sendEmail };
