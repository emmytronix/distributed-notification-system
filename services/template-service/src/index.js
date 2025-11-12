require('dotenv').config();
const fastify = require('fastify');
const cors = require('@fastify/cors');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');
const { Pool } = require('pg');
const redis = require('./services/redis.service');
const logger = require('./utils/logger');

const app = fastify({ logger: true });

app.register(swagger, {
  openapi: {
    info: {
      title: 'Template Service API',
      description: 'Template management with versioning',
      version: '1.0.0'
    }
  }
});

app.register(swaggerUi, { routePrefix: '/docs' });
app.register(cors);

let pool, redis_client;

app.addHook('onReady', async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  redis_client = await redis.connect();
  logger.info('Template Service started');
});

app.get('/health', async (req, reply) => {
  const db_healthy = await pool.query('SELECT 1').then(() => true).catch(() => false);
  const redis_healthy = redis.isConnected();
  
  const healthy = db_healthy && redis_healthy;
  
  reply.code(healthy ? 200 : 503).send({
    success: healthy,
    data: {
      status: healthy ? 'healthy' : 'unhealthy',
      database: db_healthy ? 'up' : 'down',
      redis: redis_healthy ? 'up' : 'down'
    },
    message: healthy ? 'Service healthy' : 'Service unhealthy',
    meta: null
  });
});

// POST /api/v1/templates/ - Create template
app.post('/api/v1/templates/', async (req, reply) => {
  try {
    const { name, type, subject, body, variables, language } = req.body;

    if (!name || !type || !body) {
      return reply.code(400).send({
        success: false,
        data: null,
        error: 'Missing required fields',
        message: 'name, type, and body are required',
        meta: null
      });
    }

    const result = await pool.query(
      `INSERT INTO templates (name, type, subject, body, variables, language)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, type, subject, body, JSON.stringify(variables || {}), language || 'en']
    );

    // Clear cache
    await redis_client.del(`template:${result.rows[0].id}`);
    await redis_client.del(`template:name:${name}`);

    reply.code(201).send({
      success: true,
      data: result.rows[0],
      message: 'Template created',
      meta: null
    });

  } catch (error) {
    if (error.code === '23505') {
      return reply.code(409).send({
        success: false,
        data: null,
        error: 'Template already exists',
        message: 'Template with this name already exists',
        meta: null
      });
    }
    
    logger.error({ error: error.message }, 'Error creating template');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to create template',
      meta: null
    });
  }
});

// GET /api/v1/templates/:id - Get template by ID
app.get('/api/v1/templates/:id', async (req, reply) => {
  try {
    const { id } = req.params;

    // Check cache
    const cached = await redis_client.get(`template:${id}`);
    if (cached) {
      return reply.send({
        success: true,
        data: JSON.parse(cached),
        message: 'Template retrieved (cached)',
        meta: null
      });
    }

    const result = await pool.query(
      'SELECT * FROM templates WHERE id = $1 AND is_active = true',
      [id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        success: false,
        data: null,
        error: 'Template not found',
        message: 'No active template found with this ID',
        meta: null
      });
    }

    // Cache for 1 hour
    await redis_client.setex(`template:${id}`, 3600, JSON.stringify(result.rows[0]));

    reply.send({
      success: true,
      data: result.rows[0],
      message: 'Template retrieved',
      meta: null
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error retrieving template');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to retrieve template',
      meta: null
    });
  }
});

// GET /api/v1/templates/by-name/:name - Get template by name
app.get('/api/v1/templates/by-name/:name', async (req, reply) => {
  try {
    const { name } = req.params;

    const cached = await redis_client.get(`template:name:${name}`);
    if (cached) {
      return reply.send({
        success: true,
        data: JSON.parse(cached),
        message: 'Template retrieved (cached)',
        meta: null
      });
    }

    const result = await pool.query(
      'SELECT * FROM templates WHERE name = $1 AND is_active = true',
      [name]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        success: false,
        data: null,
        error: 'Template not found',
        message: 'No active template found with this name',
        meta: null
      });
    }

    await redis_client.setex(`template:name:${name}`, 3600, JSON.stringify(result.rows[0]));

    reply.send({
      success: true,
      data: result.rows[0],
      message: 'Template retrieved',
      meta: null
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error retrieving template');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to retrieve template',
      meta: null
    });
  }
});

// GET /api/v1/templates/ - List templates
app.get('/api/v1/templates/', async (req, reply) => {
  try {
    const { type, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM templates WHERE is_active = true';
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND type = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const count_result = await pool.query(
      'SELECT COUNT(*) FROM templates WHERE is_active = true' + (type ? ' AND type = $1' : ''),
      type ? [type] : []
    );

    const total = parseInt(count_result.rows[0].count);
    const total_pages = Math.ceil(total / limit);

    reply.send({
      success: true,
      data: result.rows,
      message: 'Templates retrieved',
      meta: {
        total,
        limit: parseInt(limit),
        page: parseInt(page),
        total_pages,
        has_next: offset + limit < total,
        has_previous: page > 1
      }
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error listing templates');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to retrieve templates',
      meta: null
    });
  }
});

// PUT /api/v1/templates/:id - Update template (creates new version)
app.put('/api/v1/templates/:id', async (req, reply) => {
  try {
    const { id } = req.params;
    const { subject, body, variables } = req.body;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get current template
      const current = await client.query('SELECT * FROM templates WHERE id = $1', [id]);
      
      if (current.rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(404).send({
          success: false,
          data: null,
          error: 'Template not found',
          message: 'No template found with this ID',
          meta: null
        });
      }

      const current_version = current.rows[0].version;

      // Save current version to history
      await client.query(
        `INSERT INTO template_versions (template_id, version, subject, body, variables)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, current_version, current.rows[0].subject, current.rows[0].body, current.rows[0].variables]
      );

      // Update template
      const result = await client.query(
        `UPDATE templates 
         SET subject = COALESCE($1, subject),
             body = COALESCE($2, body),
             variables = COALESCE($3, variables),
             version = version + 1
         WHERE id = $4 RETURNING *`,
        [subject, body, variables ? JSON.stringify(variables) : null, id]
      );

      await client.query('COMMIT');

      // Clear cache
      await redis_client.del(`template:${id}`);

      reply.send({
        success: true,
        data: result.rows[0],
        message: 'Template updated',
        meta: null
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    logger.error({ error: error.message }, 'Error updating template');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to update template',
      meta: null
    });
  }
});

const start = async () => {
  await app.listen({ port: process.env.PORT || 3004, host: '0.0.0.0' });
  logger.info('Template Service running on port 3004');
};

start();