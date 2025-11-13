const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialize_transporter();
  }

  initialize_transporter() {
    const config = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    };

    this.transporter = nodemailer.createTransport(config);
    logger.info('Email transporter initialized');
  }

  async check_connection() {
    try {
      if (!this.transporter) return false;
      await this.transporter.verify();
      return true;
    } catch (error) {
      logger.error('SMTP connection check failed:', error.message);
      return false;
    }
  }

  async send_email({ to, subject, html, text }) {
    try {
      if (!this.transporter) {
        throw new Error('Email transporter not initialized');
      }

      const mail_options = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        html,
        text
      };

      const info = await this.transporter.sendMail(mail_options);
      
      logger.info({
        message_id: info.messageId,
        recipient: to
      }, 'Email sent successfully');

      return {
        success: true,
        message_id: info.messageId,
        response: info.response
      };

    } catch (error) {
      logger.error({
        error: error.message,
        recipient: to
      }, 'Failed to send email');
      throw error;
    }
  }
}

module.exports = new EmailService();