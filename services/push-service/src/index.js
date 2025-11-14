require('dotenv').config();
const fastify = require('fastify');
const rabbitmq_service = require('./services/rabbitmq.service');
const redis_service = require('./services/redis.service');
const push_service = require('./services/push.service');
const template_service = require('./services/template.service');
const retry_service = require('./services/retry.service');
const logger = require('./utils/logger');

const app = fastify({ logger: true });

app.addHook('onReady', async () => {
  try {
    await redis_service.connect();
    await rabbitmq_service.connect();
    await start_consumer();
    logger.info('Push Service started');
  } catch (error) {
    logger.error('Failed to start Push Service:', error);
    process.exit(1);
  }
});

app.get('/health', async (request, reply) => {
  reply.send({
    success: true,
    data: { status: 'healthy', timestamp: new Date().toISOString() },
    message: 'Service healthy',
    meta: null
  });
});

async function start_consumer() {
  await rabbitmq_service.consume('push.queue', async (message) => {
    const correlation_id = message.request_id;
    logger.info({ correlation_id }, 'Processing push notification');

    try {
      const processed = await redis_service.get(`processed:${correlation_id}`);
      if (processed) return true;

      const template = await template_service.get_template(message.template_code);
      const rendered = await template_service.render(template, message.variables);

      const result = await push_service.send({
        token: message.recipient,
        title: rendered.subject,
        body: rendered.body,
        data: message.variables
      });

      await redis_service.setex(`processed:${correlation_id}`, 86400, 'true');
      logger.info({ correlation_id }, 'Push sent successfully');
      return true;

    } catch (error) {
      logger.error({ correlation_id, error: error.message }, 'Error processing push');
      
      if (await retry_service.should_retry(message)) {
        await retry_service.schedule_retry(message);
        return true;
      }
      return false;
    }
  });
}

const start = async () => {
  await app.listen({ port: process.env.PORT || 3003, host: '0.0.0.0' });
};

start();