require('dotenv').config();
const fastify = require('fastify');
const rabbitmq_service = require('./services/rabbitmq.service');
const redis_service = require('./services/redis.service');
const email_service = require('./services/email.service');
const template_service = require('./services/template.service');
const retry_service = require('./services/retry.service');
const logger = require('./utils/logger');

const app = fastify({ logger: true });

let rabbitmq, redis;

app.addHook('onReady', async () => {
  try {
    redis = await redis_service.connect();
    rabbitmq = await rabbitmq_service.connect();
    await start_consumer();
    logger.info('Email Service started successfully');
  } catch (error) {
    logger.error('Failed to start Email Service:', error);
    process.exit(1);
  }
});

app.addHook('onClose', async () => {
  await rabbitmq_service.close();
  await redis_service.close();
  logger.info('Email Service shutdown complete');
});

app.get('/health', async (request, reply) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      rabbitmq: rabbitmq_service.isConnected() ? 'up' : 'down',
      redis: redis_service.isConnected() ? 'up' : 'down',
      smtp: await email_service.check_connection() ? 'up' : 'down'
    }
  };
  
  const all_healthy = Object.values(health.services).every(s => s === 'up');
  reply.code(all_healthy ? 200 : 503).send({
    success: all_healthy,
    data: health,
    message: all_healthy ? 'Service healthy' : 'Some services are down',
    meta: null
  });
});

async function start_consumer() {
  try {
    await rabbitmq_service.consume('email.queue', async (message) => {
      const start_time = Date.now();
      const correlation_id = message.request_id;
      
      logger.info({ correlation_id }, 'Processing email notification');

      try {
        // Check idempotency
        const processed = await redis.get(`processed:${correlation_id}`);
        if (processed) {
          logger.info({ correlation_id }, 'Email already processed (idempotent)');
          return true;
        }

        // Get template
        const template = await template_service.get_template(message.template_code);
        if (!template) {
          throw new Error(`Template ${message.template_code} not found`);
        }

        // Render template
        const rendered = await template_service.render(template, message.variables);

        // Send email
        const result = await email_service.send_email({
          to: message.recipient,
          subject: rendered.subject,
          html: rendered.body,
          text: rendered.body.replace(/<[^>]*>/g, '')
        });

        // Mark as processed
        await redis.setex(`processed:${correlation_id}`, 86400, 'true');
        
        // Update status
        await update_status(correlation_id, 'sent', {
          message_id: result.message_id,
          processing_time: Date.now() - start_time
        });

        logger.info({ 
          correlation_id, 
          processing_time: Date.now() - start_time 
        }, 'Email sent successfully');

        return true;

      } catch (error) {
        logger.error({ correlation_id, error: error.message }, 'Error processing email');

        const should_retry = await retry_service.should_retry(message);
        
        if (should_retry) {
          await retry_service.schedule_retry(message);
          await update_status(correlation_id, 'retrying', {
            retry_count: message.retry_count + 1,
            last_error: error.message
          });
          return true;
        } else {
          await update_status(correlation_id, 'failed', {
            error: error.message,
            retry_count: message.retry_count
          });
          return false; // Send to DLQ
        }
      }
    });

    logger.info('Started consuming from email.queue');
  } catch (error) {
    logger.error('Error starting consumer:', error);
    throw error;
  }
}

async function update_status(request_id, status, metadata = {}) {
  try {
    const status_data = {
      request_id,
      status,
      updated_at: new Date().toISOString(),
      ...metadata
    };
    await redis.setex(`status:${request_id}`, 86400, JSON.stringify(status_data));
  } catch (error) {
    logger.error('Error updating status:', error);
  }
}

const start = async () => {
  try {
    const port = process.env.PORT || 3002;
    await app.listen({ port, host: '0.0.0.0' });
    logger.info(`Email Service running on port ${port}`);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
};

start();