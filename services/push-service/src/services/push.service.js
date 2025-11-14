const admin = require('firebase-admin');
const logger = require('../utils/logger');

class PushService {
  constructor() {
    this.initialized = false;
    this.initialize_fcm();
  }

  initialize_fcm() {
    try {
      if (process.env.FCM_SERVICE_ACCOUNT) {
        const service_account = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(service_account)
        });
        this.initialized = true;
        logger.info('FCM initialized');
      } else {
        logger.warn('FCM not configured');
      }
    } catch (error) {
      logger.error('Failed to initialize FCM:', error);
    }
  }

  async send({ token, title, body, data = {} }) {
    if (!this.initialized) {
      throw new Error('Push service not initialized');
    }

    try {
      const message = {
        token,
        notification: { title, body },
        data: Object.entries(data).reduce((acc, [key, val]) => {
          acc[key] = String(val);
          return acc;
        }, {})
      };

      const response = await admin.messaging().send(message);
      logger.info({ message_id: response }, 'Push notification sent');
      return { success: true, message_id: response };

    } catch (error) {
      logger.error('Failed to send push:', error);
      throw error;
    }
  }

  async validate_token(token) {
    return token && token.length > 20;
  }
}

module.exports = new PushService();