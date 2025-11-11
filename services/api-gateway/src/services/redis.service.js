const Redis = require('ioredis');
const logger = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect() {
    try {
      const url = process.env.REDIS_URL || 'redis://localhost:6379';
      
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 50, 2000)
      });

      this.client.on('connect', () => {
        this.connected = true;
        logger.info('Redis connected successfully');
      });

      this.client.on('error', (err) => {
        logger.error('Redis error:', err);
        this.connected = false;
      });

      await this.client.ping();
      
      return this.client;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      this.connected = false;
      throw error;
    }
  }

  isConnected() {
    return this.connected;
  }

  async close() {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
      logger.info('Redis connection closed');
    }
  }
}

module.exports = new RedisService();