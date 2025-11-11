const amqp = require('amqplib');
const logger = require('../utils/logger');

class RabbitMQService {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.connected = false;
  }

  async connect() {
    try {
      const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
      
      this.connection = await amqp.connect(url, { heartbeat: 60 });

      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error:', err);
        this.connected = false;
      });

      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed. Reconnecting...');
        this.connected = false;
        setTimeout(() => this.connect(), 5000);
      });

      this.channel = await this.connection.createChannel();
      
      await this.channel.assertExchange('notifications.direct', 'direct', {
        durable: true
      });

      this.connected = true;
      logger.info('RabbitMQ connected successfully');
      
      return this;
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ:', error);
      this.connected = false;
      setTimeout(() => this.connect(), 5000);
      throw error;
    }
  }

  async publish(exchange, routing_key, message) {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQ not connected');
    }

    try {
      const content = Buffer.from(JSON.stringify(message));
      
      const published = this.channel.publish(
        exchange,
        routing_key,
        content,
        {
          persistent: true,
          contentType: 'application/json',
          timestamp: Date.now(),
          messageId: message.request_id
        }
      );

      if (!published) {
        throw new Error('Failed to publish message to queue');
      }

      logger.info(`Message published to ${exchange} with routing key ${routing_key}`);
      return true;
    } catch (error) {
      logger.error('Error publishing message:', error);
      throw error;
    }
  }

  async getQueueStats() {
    if (!this.connected || !this.channel) {
      return { email_queue: 0, push_queue: 0, failed_queue: 0 };
    }

    try {
      const email_queue = await this.channel.checkQueue('email.queue');
      const push_queue = await this.channel.checkQueue('push.queue');
      const failed_queue = await this.channel.checkQueue('failed.queue');

      return {
        email_queue: email_queue.messageCount,
        push_queue: push_queue.messageCount,
        failed_queue: failed_queue.messageCount
      };
    } catch (error) {
      logger.error('Error getting queue stats:', error);
      return { email_queue: 0, push_queue: 0, failed_queue: 0 };
    }
  }

  isConnected() {
    return this.connected;
  }

  async close() {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
      this.connected = false;
      logger.info('RabbitMQ connection closed');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection:', error);
    }
  }
}

module.exports = new RabbitMQService();