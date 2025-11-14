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
        logger.warn('RabbitMQ connection closed');
        this.connected = false;
        setTimeout(() => this.connect(), 5000);
      });

      this.channel = await this.connection.createChannel();
      await this.channel.prefetch(10);

      this.connected = true;
      logger.info('RabbitMQ connected');
      
      return this;
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ:', error);
      setTimeout(() => this.connect(), 5000);
      throw error;
    }
  }

  async consume(queue, handler) {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQ not connected');
    }

    await this.channel.assertQueue(queue, { durable: true });

    this.channel.consume(queue, async (msg) => {
      if (msg !== null) {
        try {
          const content = JSON.parse(msg.content.toString());
          const success = await handler(content);

          if (success) {
            this.channel.ack(msg);
          } else {
            this.channel.nack(msg, false, false);
          }
        } catch (error) {
          logger.error('Error processing message:', error);
          this.channel.nack(msg, false, false);
        }
      }
    });
  }

  async publish(exchange, routing_key, message) {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQ not connected');
    }

    const content = Buffer.from(JSON.stringify(message));
    return this.channel.publish(exchange, routing_key, content, {
      persistent: true,
      contentType: 'application/json'
    });
  }

  isConnected() {
    return this.connected;
  }

  async close() {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
    this.connected = false;
  }
}

module.exports = new RabbitMQService();