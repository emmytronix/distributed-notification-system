require('dotenv').config();
const fastify = require('fastify');
const cors = require('@fastify/cors');
const swagger = require('@fastify/swagger');
const swaggerUi = require('@fastify/swagger-ui');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const redis = require('./services/redis.service');
const logger = require('./utils/logger');

const app = fastify({ logger: true });

// Swagger Documentation
app.register(swagger, {
  openapi: {
    info: {
      title: 'User Service API',
      description: 'User management and authentication',
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
  logger.info('User Service started');
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

// POST /api/v1/users/ - Register
app.post('/api/v1/users/', async (req, reply) => {
  try {
    const { name, email, password, push_token, preferences } = req.body;

    if (!name || !email || !password) {
      return reply.code(400).send({
        success: false,
        data: null,
        error: 'Missing required fields',
        message: 'name, email, and password are required',
        meta: null
      });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const name_parts = name.trim().split(' ');
    const first_name = name_parts[0];
    const last_name = name_parts.slice(1).join(' ') || '';

    const result = await pool.query(
      `INSERT INTO users (email, username, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, email, first_name, last_name, created_at`,
      [email, email.split('@')[0], password_hash, first_name, last_name]
    );

    const user = result.rows[0];

    // Create preferences
    const email_enabled = preferences?.email !== undefined ? preferences.email : true;
    const push_enabled = preferences?.push !== undefined ? preferences.push : true;

    await pool.query(
      `INSERT INTO user_preferences (user_id, email_enabled, push_enabled) VALUES ($1, $2, $3)`,
      [user.id, email_enabled, push_enabled]
    );

    // Add push token if provided
    if (push_token) {
      await pool.query(
        `INSERT INTO push_tokens (user_id, token, device_type) VALUES ($1, $2, $3)`,
        [user.id, push_token, 'unknown']
      );
    }

    reply.code(201).send({
      success: true,
      data: {
        user_id: user.id,
        name: `${user.first_name} ${user.last_name}`.trim(),
        email: user.email,
        preferences: { email: email_enabled, push: push_enabled },
        created_at: user.created_at
      },
      message: 'User registered successfully',
      meta: null
    });

  } catch (error) {
    if (error.code === '23505') {
      return reply.code(409).send({
        success: false,
        data: null,
        error: 'User already exists',
        message: 'Email already registered',
        meta: null
      });
    }
    
    logger.error({ error: error.message }, 'Error registering user');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to register user',
      meta: null
    });
  }
});

// POST /api/v1/users/login/ - Login
app.post('/api/v1/users/login/', async (req, reply) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return reply.code(401).send({
        success: false,
        data: null,
        error: 'Invalid credentials',
        message: 'Email or password incorrect',
        meta: null
      });
    }

    const user = result.rows[0];
    const valid_password = await bcrypt.compare(password, user.password_hash);

    if (!valid_password) {
      return reply.code(401).send({
        success: false,
        data: null,
        error: 'Invalid credentials',
        message: 'Email or password incorrect',
        meta: null
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    reply.send({
      success: true,
      data: {
        token,
        user: {
          user_id: user.id,
          email: user.email,
          name: `${user.first_name} ${user.last_name}`.trim()
        }
      },
      message: 'Login successful',
      meta: null
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error during login');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Login failed',
      meta: null
    });
  }
});

// GET /api/v1/users/:user_id - Get user profile
app.get('/api/v1/users/:user_id', async (req, reply) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.created_at,
              up.email_enabled, up.push_enabled,
              COALESCE(
                json_agg(json_build_object('token', pt.token, 'device_type', pt.device_type))
                FILTER (WHERE pt.token IS NOT NULL), '[]'
              ) as push_tokens
       FROM users u
       LEFT JOIN user_preferences up ON u.id = up.user_id
       LEFT JOIN push_tokens pt ON u.id = pt.user_id AND pt.is_active = true
       WHERE u.id = $1
       GROUP BY u.id, up.email_enabled, up.push_enabled`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        success: false,
        data: null,
        error: 'User not found',
        message: 'No user found with this ID',
        meta: null
      });
    }

    const user = result.rows[0];
    const push_token = user.push_tokens.length > 0 ? user.push_tokens[0].token : null;

    reply.send({
      success: true,
      data: {
        user_id: user.id,
        name: `${user.first_name} ${user.last_name}`.trim(),
        email: user.email,
        push_token,
        preferences: {
          email: user.email_enabled,
          push: user.push_enabled
        },
        is_active: user.is_active,
        created_at: user.created_at
      },
      message: 'User retrieved successfully',
      meta: null
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error retrieving user');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to retrieve user',
      meta: null
    });
  }
});

// PUT /api/v1/users/:user_id/preferences/ - Update preferences
app.put('/api/v1/users/:user_id/preferences/', async (req, reply) => {
  try {
    const { user_id } = req.params;
    const { email, push } = req.body;

    const result = await pool.query(
      `UPDATE user_preferences 
       SET email_enabled = COALESCE($1, email_enabled),
           push_enabled = COALESCE($2, push_enabled)
       WHERE user_id = $3
       RETURNING *`,
      [email, push, user_id]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        success: false,
        data: null,
        error: 'User not found',
        message: 'No user found with this ID',
        meta: null
      });
    }

    reply.send({
      success: true,
      data: {
        user_id,
        preferences: {
          email: result.rows[0].email_enabled,
          push: result.rows[0].push_enabled
        }
      },
      message: 'Preferences updated successfully',
      meta: null
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error updating preferences');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to update preferences',
      meta: null
    });
  }
});

const start = async () => {
  await app.listen({ port: process.env.PORT || 3001, host: '0.0.0.0' });
  logger.info('User Service running on port 3001');
};

start();