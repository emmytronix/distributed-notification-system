require('dotenv').config();
const fastify = require('fastify');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');
const { v4: uuidv4 } = require('uuid');

const rabbitmq_service = require('./services/rabbitmq.service');
const redis_service = require('./services/redis.service');
const circuit_breaker = require('./utils/circuit-breaker');
const logger = require('./utils/logger');

const app = fastify({ logger: true });

// Swagger Documentation
app.register(swagger, {
  openapi: {
    info: {
      title: 'Notification System API',
      description: 'Distributed notification system for emails and push notifications',
      version: '1.0.0'
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  }
});

app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false
  }
});

// Middleware
app.register(cors);
app.register(helmet);
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
});

let rabbitmq, redis;

// Startup
app.addHook('onReady', async () => {
  try {
    rabbitmq = await rabbitmq_service.connect();
    redis = await redis_service.connect();
    logger.info('API Gateway services connected successfully');
  } catch (error) {
    logger.error('Failed to connect services:', error);
    process.exit(1);
  }
});

// Graceful shutdown
app.addHook('onClose', async () => {
  await rabbitmq_service.close();
  await redis_service.close();
  logger.info('API Gateway shutdown complete');
});

// Health check
app.get('/health', async (request, reply) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      rabbitmq: rabbitmq_service.isConnected() ? 'up' : 'down',
      redis: redis_service.isConnected() ? 'up' : 'down'
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

// Authentication middleware
app.decorate('authenticate', async (request, reply) => {
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.code(401).send({
        success: false,
        data: null,
        error: 'No token provided',
        message: 'Authentication required',
        meta: null
      });
    }

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    request.user = decoded;
  } catch (error) {
    return reply.code(401).send({
      success: false,
      data: null,
      error: 'Invalid token',
      message: 'Authentication failed',
      meta: null
    });
  }
});

// POST /api/v1/notifications/ - Send notification
app.post('/api/v1/notifications/', {
  onRequest: [app.authenticate],
  schema: {
    description: 'Send a notification',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }],
    body: {
      type: 'object',
      required: ['notification_type', 'user_id', 'template_code', 'variables'],
      properties: {
        notification_type: { 
          type: 'string', 
          enum: ['email', 'push']
        },
        user_id: { 
          type: 'string', 
          format: 'uuid'
        },
        template_code: { 
          type: 'string'
        },
        variables: {
          type: 'object'
        },
        request_id: { 
          type: 'string'
        },
        priority: { 
          type: 'integer',
          default: 2
        },
        metadata: { 
          type: 'object'
        }
      }
    }
  }
}, async (request, reply) => {
  const request_id = request.body.request_id || uuidv4();
  
  try {
    const { 
      notification_type, 
      user_id, 
      template_code, 
      variables, 
      priority = 2, 
      metadata 
    } = request.body;

    // Validate notification type
    if (!['email', 'push'].includes(notification_type)) {
      return reply.code(400).send({
        success: false,
        data: null,
        error: 'Invalid notification type',
        message: 'notification_type must be either email or push',
        meta: null
      });
    }

    // Check idempotency
    const idempotency_key = `notif:${user_id}:${notification_type}:${template_code}:${request_id}`;
    const existing = await redis.get(idempotency_key);
    
    if (existing) {
      return reply.code(200).send({
        success: true,
        data: JSON.parse(existing),
        message: 'Notification already processed (idempotent)',
        meta: null
      });
    }

    // Get user info to find recipient
    const axios = require('axios');
    let recipient;
    
    try {
      const user_response = await axios.get(
        `${process.env.USER_SERVICE_URL}/api/v1/users/${user_id}`
      );
      
      if (notification_type === 'email') {
        recipient = user_response.data.data.email;
      } else {
        recipient = user_response.data.data.push_token;
      }
      
      if (!recipient) {
        throw new Error(`User has no ${notification_type} contact info`);
      }
    } catch (error) {
      return reply.code(404).send({
        success: false,
        data: null,
        error: 'User not found or missing contact info',
        message: error.message,
        meta: null
      });
    }

    // Prepare message for queue
    const message = {
      notification_id: uuidv4(),
      request_id,
      user_id,
      notification_type,
      recipient,
      template_code,
      variables: variables || {},
      priority: priority,
      metadata: metadata || {},
      created_at: new Date().toISOString(),
      retry_count: 0
    };

    // Use circuit breaker to publish to queue
    const routing_key = notification_type === 'email' ? 'email' : 'push';
    
    await circuit_breaker.execute(
      'rabbitmq',
      async () => {
        await rabbitmq_service.publish('notifications.direct', routing_key, message);
      }
    );

    // Store in Redis for status tracking and idempotency
    const notification_data = {
      notification_id: message.notification_id,
      request_id,
      status: 'queued',
      notification_type,
      user_id,
      created_at: message.created_at
    };
    
    await redis.setex(idempotency_key, 3600, JSON.stringify(notification_data));
    await redis.setex(`status:${request_id}`, 86400, JSON.stringify(notification_data));

    logger.info({ request_id, notification_type }, 'Notification queued successfully');

    return reply.code(202).send({
      success: true,
      data: notification_data,
      message: 'Notification queued successfully',
      meta: null
    });

  } catch (error) {
    logger.error({ request_id, error: error.message }, 'Error queuing notification');
    
    return reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to queue notification',
      meta: null
    });
  }
});

// GET /api/v1/notifications/:notification_id/status/ - Get status
app.get('/api/v1/notifications/:notification_id/status/', {
  onRequest: [app.authenticate],
  schema: {
    description: 'Get notification status',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }]
  }
}, async (request, reply) => {
  try {
    const { notification_id } = request.params;
    
    let status = await redis.get(`status:${notification_id}`);
    
    if (!status) {
      return reply.code(404).send({
        success: false,
        data: null,
        error: 'Notification not found',
        message: 'No notification found with this ID',
        meta: null
      });
    }

    const status_data = JSON.parse(status);

    return reply.code(200).send({
      success: true,
      data: {
        notification_id: status_data.notification_id || notification_id,
        status: status_data.status,
        timestamp: status_data.updated_at || status_data.created_at,
        error: status_data.error || null
      },
      message: 'Notification status retrieved',
      meta: null
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error getting notification status');
    
    return reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to get notification status',
      meta: null
    });
  }
});

// POST /api/v1/notifications/bulk/ - Bulk send
app.post('/api/v1/notifications/bulk/', {
  onRequest: [app.authenticate],
  schema: {
    description: 'Send multiple notifications at once',
    tags: ['Notifications'],
    security: [{ bearerAuth: [] }]
  }
}, async (request, reply) => {
  try {
    const { notifications } = request.body;

    if (!Array.isArray(notifications) || notifications.length === 0) {
      return reply.code(400).send({
        success: false,
        data: null,
        error: 'Invalid request',
        message: 'notifications must be a non-empty array',
        meta: null
      });
    }

    const results = [];
    
    for (const notif of notifications) {
      const request_id = notif.request_id || uuidv4();
      const notification_id = uuidv4();
      
      const message = {
        notification_id,
        request_id,
        user_id: notif.user_id,
        notification_type: notif.notification_type,
        template_code: notif.template_code,
        variables: notif.variables || {},
        priority: notif.priority || 2,
        metadata: notif.metadata || {},
        created_at: new Date().toISOString(),
        retry_count: 0
      };

      try {
        const routing_key = notif.notification_type === 'email' ? 'email' : 'push';
        await rabbitmq_service.publish('notifications.direct', routing_key, message);
        
        results.push({
          notification_id,
          request_id,
          status: 'queued',
          user_id: notif.user_id
        });
      } catch (error) {
        results.push({
          notification_id,
          request_id,
          status: 'failed',
          user_id: notif.user_id,
          error: error.message
        });
      }
    }

    const queued_count = results.filter(r => r.status === 'queued').length;
    const failed_count = results.filter(r => r.status === 'failed').length;

    return reply.code(202).send({
      success: true,
      data: results,
      message: `Queued ${queued_count} of ${notifications.length} notifications`,
      meta: {
        total: results.length,
        queued: queued_count,
        failed: failed_count
      }
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error bulk sending notifications');
    
    return reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to queue bulk notifications',
      meta: null
    });
  }
});

// GET /api/v1/metrics/ - Get metrics
app.get('/api/v1/metrics/', {
  schema: {
    description: 'Get system metrics',
    tags: ['System']
  }
}, async (request, reply) => {
  try {
    const queue_stats = await rabbitmq_service.getQueueStats();
    const circuit_breaker_stats = circuit_breaker.getStats();
    
    return reply.code(200).send({
      success: true,
      data: {
        queues: queue_stats,
        circuit_breakers: circuit_breaker_stats,
        timestamp: new Date().toISOString()
      },
      message: 'Metrics retrieved successfully',
      meta: null
    });
  } catch (error) {
    return reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to retrieve metrics',
      meta: null
    });
  }
});

// Start server
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await app.listen({ port, host: '0.0.0.0' });
    logger.info(`API Gateway running on port ${port}`);
    logger.info(`Swagger docs available at http://localhost:${port}/docs`);
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
};

start();