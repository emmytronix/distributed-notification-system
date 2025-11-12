# Distributed Notification System - Complete Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites & Setup](#prerequisites--setup)
4. [Services Overview](#services-overview)
5. [API Reference](#api-reference)
6. [Database Schema](#database-schema)
7. [Configuration](#configuration)
8. [Development Guide](#development-guide)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)
11. [Performance & Monitoring](#performance--monitoring)

---

## Overview

The **Distributed Notification System** is a production-ready microservices platform designed to send email and push notifications at scale. Built with Node.js, it leverages a message-driven architecture for reliability, scalability, and fault tolerance.

### Key Features
- ✅ **Multi-channel support** - Email and push notifications
- ✅ **Template management** - With versioning and caching
- ✅ **Message queue** - RabbitMQ with Dead Letter Queue (DLQ)
- ✅ **Redis caching** - For performance optimization
- ✅ **Circuit breaker** - Fault tolerance pattern
- ✅ **Idempotent operations** - Prevent duplicate sends
- ✅ **JWT authentication** - Secure API access
- ✅ **Rate limiting** - Protection against abuse
- ✅ **Health checks** - Built-in monitoring
- ✅ **OpenAPI/Swagger** - Interactive API docs

### Tech Stack
- **Runtime**: Node.js 18+
- **Framework**: Fastify (lightweight & fast)
- **Database**: PostgreSQL 15
- **Message Broker**: RabbitMQ 3.12
- **Cache**: Redis 7
- **Container**: Docker & Docker Compose
- **Security**: JWT, bcrypt, helmet

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Applications                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                    HTTP/REST
                         │
                         ▼
        ┌────────────────────────────────┐
        │    API Gateway (3000)          │
        │ - Authentication (JWT)         │
        │ - Rate Limiting                │
        │ - Request Validation           │
        │ - Circuit Breaker              │
        └────────────┬───────────────────┘
                     │
        ┌────────────┴─────────────┐
        ▼                          ▼
    ┌────────────┐          ┌──────────────┐
    │ User Svc   │          │ Template Svc │
    │ (3001)     │          │ (3004)       │
    └────────────┘          └──────────────┘
        │                          │
        ├─ PostgreSQL ─────────────┤
        │  3 Databases             │
        │                          │
        └──────────┬───────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
    ┌─────────────────────────────┐
    │     RabbitMQ Broker         │
    │ notifications.direct        │
    │ ├─ Email Queue              │
    │ ├─ Push Queue               │
    │ └─ DLQ (Failed)             │
    └──────────┬──────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
    ┌─────────┐  ┌──────────┐
    │ Email   │  │ Push     │
    │ Service │  │ Service  │
    │(Consumer)  │(Consumer)
    └─────────┘  └──────────┘
        │             │
        └─────┬───────┘
              ▼
        ┌──────────────┐
        │ Redis Cache  │
        │ - Idempotency│
        │ - Status     │
        │ - Caching    │
        └──────────────┘
```

### Data Flow for Sending a Notification

1. **Client Request** → API Gateway
2. **Authentication** → Validate JWT token
3. **Validation** → Check request format
4. **User Lookup** → Fetch user from User Service
5. **Idempotency Check** → Verify in Redis (prevent duplicates)
6. **Queue Message** → Publish to RabbitMQ
7. **Status Tracking** → Store in Redis
8. **Response** → Return 202 Accepted
9. **Consumer Processing** → Email/Push Service consumes message
10. **Send** → Deliver to recipient
11. **Status Update** → Mark as sent or failed

### Database Per Service Pattern

Each microservice has its own PostgreSQL database:
- **user_service_db** - User accounts, preferences, push tokens
- **template_service_db** - Email/push templates and versions
- **notification_logs_db** - Notification audit logs

---

## Prerequisites & Setup

### System Requirements

```bash
# Minimum
- Docker 20.10+
- Docker Compose 2.0+
- 4GB RAM
- 10GB Disk space

# For local development
- Node.js 18+ (https://nodejs.org/)
- npm 9+
- Git
```

### Installation Steps

#### 1. Clone Repository
```bash
git clone <repository-url>
cd distributed-notification-system
```

#### 2. Configure Environment
```bash
# Copy example environment file
cp .env.example .env

# Edit with your values
nano .env
# Update:
# - JWT_SECRET (strong random key)
# - SMTP credentials (if using email)
# - FCM key (if using push)
```

#### 3. Start Docker Services
```bash
# Build and start all containers
docker-compose up -d

# Verify all services are running
docker-compose ps

# Expected output:
# NAME                 STATUS
# notification-postgres    Up (healthy)
# notification-redis       Up (healthy)
# notification-rabbitmq    Up (healthy)
# user-service             Up (healthy)
# template-service         Up (healthy)
# api-gateway              Up (healthy)
```

#### 4. Verify Services
```bash
# Check API Gateway health
curl http://localhost:3000/health

# Check User Service health
curl http://localhost:3001/health

# Check Template Service health
curl http://localhost:3004/health

# Expected response:
# {
#   "success": true,
#   "data": {
#     "status": "healthy",
#     "database": "up",
#     "redis": "up"
#   }
# }
```

### Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| API Gateway | http://localhost:3000 | Main API endpoint |
| API Documentation | http://localhost:3000/docs | Interactive Swagger UI |
| User Service | http://localhost:3001 | User management API |
| User Service Docs | http://localhost:3001/docs | User API docs |
| Template Service | http://localhost:3004 | Template management API |
| Template Docs | http://localhost:3004/docs | Template API docs |
| RabbitMQ Admin | http://localhost:15672 | Message queue UI |
| PostgreSQL | localhost:5432 | Database connection |
| Redis | localhost:6379 | Cache store |

**RabbitMQ Credentials**: `rabbit_user` / `rabbit_password`  
**Database Credentials**: `notif_admin` / `notif_admin_password`

---

## Services Overview

### API Gateway (Port 3000)

**Purpose**: Central entry point for all client requests

**Location**: [`services/api-gateway`](services/api-gateway)

**Key Responsibilities**:
- Request authentication (JWT validation)
- Rate limiting (100 req/min)
- Security headers (Helmet)
- Message routing to RabbitMQ
- Notification status tracking
- Circuit breaker management

**Key Files**:
- [`src/index.js`](services/api-gateway/src/index.js) - Main application
- [`src/services/rabbitmq.service.js`](services/api-gateway/src/services/rabbitmq.service.js) - RabbitMQ client
- [`src/services/redis.service.js`](services/api-gateway/src/services/redis.service.js) - Redis client
- [`src/utils/circuit-breaker.js`](services/api-gateway/src/utils/circuit-breaker.js) - Circuit breaker pattern

**Dependencies**:
- RabbitMQ (message queue)
- Redis (caching & status)
- User Service (user lookup)

**Environment Variables**:
```env
PORT=3000
RABBITMQ_URL=amqp://rabbit_user:rabbit_password@rabbitmq:5672
REDIS_URL=redis://redis:6379
USER_SERVICE_URL=http://user-service:3001
TEMPLATE_SERVICE_URL=http://template-service:3004
JWT_SECRET=your-super-secret-jwt-key-change-in-production
LOG_LEVEL=info
```

### User Service (Port 3001)

**Purpose**: User account management and authentication

**Location**: [`services/user-service`](services/user-service)

**Key Responsibilities**:
- User registration & login
- Password hashing (bcrypt)
- JWT token generation
- User preferences management
- Push token storage
- Profile management

**Key Files**:
- [`src/index.js`](services/user-service/src/index.js) - API endpoints
- [`src/services/redis.service.js`](services/user-service/src/services/redis.service.js) - Redis integration
- [`src/utils/logger.js`](services/user-service/src/utils/logger.js) - Logging

**Database**: `user_service_db`

**Tables**:
- `users` - User accounts
- `user_preferences` - Notification preferences
- `push_tokens` - Firebase Cloud Messaging tokens

**Environment Variables**:
```env
PORT=3001
DATABASE_URL=postgresql://notif_admin:notif_admin_password@postgres:5432/user_service_db
REDIS_URL=redis://redis:6379
JWT_SECRET=your-super-secret-jwt-key-change-in-production
LOG_LEVEL=info
```

### Template Service (Port 3004)

**Purpose**: Template management with versioning and caching

**Location**: [`services/template-service`](services/template-service)

**Key Responsibilities**:
- Create/update notification templates
- Template versioning
- Template caching (1-hour TTL)
- Support for Handlebars variables
- Template listing with filtering

**Key Files**:
- [`src/index.js`](services/template-service/src/index.js) - API endpoints
- [`src/services/redis.service.js`](services/template-service/src/services/redis.service.js) - Redis integration
- [`src/utils/logger.js`](services/template-service/src/utils/logger.js) - Logging

**Database**: `template_service_db`

**Tables**:
- `templates` - Active templates
- `template_versions` - Template version history

**Environment Variables**:
```env
PORT=3004
DATABASE_URL=postgresql://notif_admin:notif_admin_password@postgres:5432/template_service_db
REDIS_URL=redis://redis:6379
LOG_LEVEL=info
```

### Email Service (Consumer)

**Purpose**: Process and send email notifications (to be implemented)

**Consumer Implementation**:
- Listens to `email.queue`
- Fetches template from Template Service
- Renders Handlebars variables
- Sends via SMTP
- Updates status or moves to DLQ on failure
- Implements retry logic

### Push Service (Consumer)

**Purpose**: Process and send push notifications (to be implemented)

**Consumer Implementation**:
- Listens to `push.queue`
- Fetches user's FCM token
- Sends via Firebase Cloud Messaging
- Updates status or moves to DLQ on failure
- Handles token refresh

---

## API Reference

### Authentication

All protected endpoints require a Bearer token in the Authorization header:

```http
Authorization: Bearer <JWT_TOKEN>
```

To get a token, call the login endpoint first.

### User Service Endpoints

#### Register User
```http
POST /api/v1/users/
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "secure_password_123",
  "push_token": "fcm_token_optional",
  "preferences": {
    "email": true,
    "push": true
  }
}
```

**Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "John Doe",
    "email": "john@example.com",
    "preferences": {
      "email": true,
      "push": true
    },
    "created_at": "2024-01-15T10:30:00Z"
  },
  "message": "User registered successfully",
  "meta": null
}
```

**Error Responses**:
- `400 Bad Request` - Missing required fields
- `409 Conflict` - Email already exists

---

#### Login User
```http
POST /api/v1/users/login/
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "secure_password_123"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "john@example.com",
      "name": "John Doe"
    }
  },
  "message": "Login successful",
  "meta": null
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid credentials

---

#### Get User Profile
```http
GET /api/v1/users/{user_id}
Authorization: Bearer <JWT_TOKEN>
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "John Doe",
    "email": "john@example.com",
    "push_token": "fcm_token_xyz",
    "preferences": {
      "email": true,
      "push": true
    },
    "is_active": true,
    "created_at": "2024-01-15T10:30:00Z"
  },
  "message": "User retrieved successfully",
  "meta": null
}
```

---

#### Update User Preferences
```http
PUT /api/v1/users/{user_id}/preferences/
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "email": false,
  "push": true
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "preferences": {
      "email": false,
      "push": true
    }
  },
  "message": "Preferences updated successfully",
  "meta": null
}
```

---

### Template Service Endpoints

#### Create Template
```http
POST /api/v1/templates/
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "name": "welcome_email",
  "type": "email",
  "subject": "Welcome to {{app_name}}!",
  "body": "Hello {{user_name}}, welcome aboard! Click here: {{action_url}}",
  "variables": {
    "app_name": "string",
    "user_name": "string",
    "action_url": "string"
  },
  "language": "en"
}
```

**Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "id": "660f8500-f40c-52e5-b827-557766551111",
    "name": "welcome_email",
    "type": "email",
    "subject": "Welcome to {{app_name}}!",
    "body": "Hello {{user_name}}, welcome aboard! Click here: {{action_url}}",
    "variables": {
      "app_name": "string",
      "user_name": "string",
      "action_url": "string"
    },
    "language": "en",
    "version": 1,
    "is_active": true,
    "created_at": "2024-01-15T11:00:00Z"
  },
  "message": "Template created",
  "meta": null
}
```

---

#### Get Template by ID
```http
GET /api/v1/templates/{template_id}
Authorization: Bearer <JWT_TOKEN>
```

**Response (200 OK)** - Same as create response

**Response (404 Not Found)**:
```json
{
  "success": false,
  "data": null,
  "error": "Template not found",
  "message": "No active template found with this ID",
  "meta": null
}
```

---

#### Get Template by Name
```http
GET /api/v1/templates/by-name/{template_name}
Authorization: Bearer <JWT_TOKEN>
```

**Example**:
```http
GET /api/v1/templates/by-name/welcome_email
```

**Response**: Same as get by ID

---

#### List Templates
```http
GET /api/v1/templates/?type=email&page=1&limit=10
Authorization: Bearer <JWT_TOKEN>
```

**Query Parameters**:
- `type` (optional) - Filter by type: `email` or `push`
- `page` (optional) - Page number, default 1
- `limit` (optional) - Items per page, default 10

**Response (200 OK)**:
```json
{
  "success": true,
  "data": [
    {
      "id": "660f8500-f40c-52e5-b827-557766551111",
      "name": "welcome_email",
      "type": "email",
      "subject": "Welcome to {{app_name}}!",
      "version": 1,
      "is_active": true,
      "created_at": "2024-01-15T11:00:00Z"
    }
  ],
  "message": "Templates retrieved",
  "meta": {
    "total": 15,
    "limit": 10,
    "page": 1,
    "total_pages": 2,
    "has_next": true,
    "has_previous": false
  }
}
```

---

#### Update Template (Creates Version)
```http
PUT /api/v1/templates/{template_id}
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "subject": "Welcome to {{app_name}} - Updated!",
  "body": "Updated body content with {{new_variable}}",
  "variables": {
    "app_name": "string",
    "user_name": "string",
    "new_variable": "string"
  }
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": "660f8500-f40c-52e5-b827-557766551111",
    "name": "welcome_email",
    "type": "email",
    "subject": "Welcome to {{app_name}} - Updated!",
    "body": "Updated body content with {{new_variable}}",
    "version": 2,
    "is_active": true,
    "created_at": "2024-01-15T11:00:00Z",
    "updated_at": "2024-01-15T12:30:00Z"
  },
  "message": "Template updated",
  "meta": null
}
```

---

### Notification APIs (API Gateway)

#### Send Single Notification
```http
POST /api/v1/notifications/
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "notification_type": "email",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "template_code": "welcome_email",
  "variables": {
    "user_name": "John",
    "app_name": "MyApp",
    "action_url": "https://myapp.com/welcome"
  },
  "priority": 2,
  "metadata": {
    "campaign_id": "camp_xyz",
    "source": "signup"
  }
}
```

**Response (202 Accepted)**:
```json
{
  "success": true,
  "data": {
    "notification_id": "770g9611-f51d-63f6-c938-668877662222",
    "request_id": "req_123456",
    "status": "queued",
    "notification_type": "email",
    "user_id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "message": "Notification queued successfully",
  "meta": null
}
```

**Error Responses**:
- `400 Bad Request` - Invalid notification type
- `404 Not Found` - User not found
- `401 Unauthorized` - Invalid token
- `429 Too Many Requests` - Rate limit exceeded

---

#### Send Bulk Notifications
```http
POST /api/v1/notifications/bulk/
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "notifications": [
    {
      "notification_type": "email",
      "user_id": "550e8400-e29b-41d4-a716-446655440000",
      "template_code": "welcome_email",
      "variables": {
        "user_name": "John",
        "app_name": "MyApp",
        "action_url": "https://myapp.com/welcome"
      }
    },
    {
      "notification_type": "push",
      "user_id": "660f9511-g62e-74g7-d949-779988773333",
      "template_code": "alert",
      "variables": {
        "title": "Important Alert",
        "message": "Your account needs attention"
      }
    }
  ]
}
```

**Response (202 Accepted)**:
```json
{
  "success": true,
  "data": [
    {
      "notification_id": "770g9611-f51d-63f6-c938-668877662222",
      "request_id": "bulk_1",
      "status": "queued",
      "user_id": "550e8400-e29b-41d4-a716-446655440000"
    },
    {
      "notification_id": "880h0722-g62e-74g7-d949-779988773333",
      "request_id": "bulk_2",
      "status": "queued",
      "user_id": "660f9511-g62e-74g7-d949-779988773333"
    }
  ],
  "message": "Queued 2 of 2 notifications",
  "meta": {
    "total": 2,
    "queued": 2,
    "failed": 0
  }
}
```

---

#### Get Notification Status
```http
GET /api/v1/notifications/{notification_id}/status/
Authorization: Bearer <JWT_TOKEN>
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "notification_id": "770g9611-f51d-63f6-c938-668877662222",
    "status": "queued",
    "timestamp": "2024-01-15T13:00:00Z",
    "error": null
  },
  "message": "Notification status retrieved",
  "meta": null
}
```

**Possible Status Values**:
- `queued` - In message queue
- `sent` - Successfully delivered
- `failed` - Delivery failed
- `retrying` - Attempting retry

---

#### Get System Metrics
```http
GET /api/v1/metrics/
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "queues": {
      "email_queue": 5,
      "push_queue": 2,
      "failed_queue": 0
    },
    "circuit_breakers": {
      "rabbitmq": {
        "state": "CLOSED",
        "failures": 0,
        "successes": 142
      }
    },
    "timestamp": "2024-01-15T13:05:00Z"
  },
  "message": "Metrics retrieved successfully",
  "meta": null
}
```

---

## Database Schema

### User Service Database (`user_service_db`)

#### users
```sql
-- User accounts table
id              UUID PRIMARY KEY
email           VARCHAR(255) UNIQUE NOT NULL
username        VARCHAR(100) UNIQUE NOT NULL
password_hash   VARCHAR(255) NOT NULL
first_name      VARCHAR(100)
last_name       VARCHAR(100)
is_active       BOOLEAN DEFAULT true
is_verified     BOOLEAN DEFAULT false
created_at      TIMESTAMP DEFAULT now()
updated_at      TIMESTAMP DEFAULT now()
```

**Indexes**:
- `idx_users_email` - Quick email lookups

---

#### user_preferences
```sql
-- User notification preferences
id                      UUID PRIMARY KEY
user_id                 UUID FOREIGN KEY (users)
email_enabled           BOOLEAN DEFAULT true
push_enabled            BOOLEAN DEFAULT true
notification_frequency  VARCHAR(50) DEFAULT 'immediate'
created_at              TIMESTAMP DEFAULT now()
updated_at              TIMESTAMP DEFAULT now()
UNIQUE(user_id)
```

---

#### push_tokens
```sql
-- Firebase Cloud Messaging tokens
id          UUID PRIMARY KEY
user_id     UUID FOREIGN KEY (users)
token       TEXT UNIQUE NOT NULL
device_type VARCHAR(50) NOT NULL
is_active   BOOLEAN DEFAULT true
created_at  TIMESTAMP DEFAULT now()
updated_at  TIMESTAMP DEFAULT now()
```

**Indexes**:
- `idx_push_tokens_user_id` - Quick user lookups

---

### Template Service Database (`template_service_db`)

#### templates
```sql
-- Active notification templates
id          UUID PRIMARY KEY
name        VARCHAR(100) UNIQUE NOT NULL
type        VARCHAR(50) NOT NULL ('email' or 'push')
subject     VARCHAR(255)
body        TEXT NOT NULL
variables   JSONB
language    VARCHAR(10) DEFAULT 'en'
version     INTEGER DEFAULT 1
is_active   BOOLEAN DEFAULT true
created_at  TIMESTAMP DEFAULT now()
updated_at  TIMESTAMP DEFAULT now()
```

**Indexes**:
- `idx_templates_name` - Quick template lookups

---

#### template_versions
```sql
-- Template version history
id          UUID PRIMARY KEY
template_id UUID FOREIGN KEY (templates)
version     INTEGER NOT NULL
subject     VARCHAR(255)
body        TEXT NOT NULL
variables   JSONB
created_at  TIMESTAMP DEFAULT now()
UNIQUE(template_id, version)
```

---

### Notification Logs Database (`notification_logs_db`)

#### notification_logs
```sql
-- Audit trail of all notifications
id              UUID PRIMARY KEY
request_id      VARCHAR(100) UNIQUE NOT NULL
notification_id VARCHAR(100) UNIQUE NOT NULL
user_id         UUID NOT NULL
notification_type VARCHAR(50) NOT NULL
template_code   VARCHAR(100)
recipient       VARCHAR(255) NOT NULL
status          VARCHAR(50) NOT NULL
error_message   TEXT
retry_count     INTEGER DEFAULT 0
created_at      TIMESTAMP DEFAULT now()
updated_at      TIMESTAMP DEFAULT now()
```

**Indexes**:
- `idx_notification_logs_request_id` - Quick request lookup
- `idx_notification_logs_status` - Filter by status

---

## Configuration

### Root Environment (`.env`)

```env
# PostgreSQL - Master credentials
POSTGRES_ADMIN_USER=notif_admin
POSTGRES_ADMIN_PASSWORD=notif_admin_password

# RabbitMQ - Message broker credentials
RABBITMQ_USER=rabbit_user
RABBITMQ_PASSWORD=rabbit_password

# JWT - Token signing key
# IMPORTANT: Change this in production to a strong random key
# Generate with: openssl rand -base64 32
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# SMTP - Email sending credentials (for Email Service)
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-specific-password
SMTP_FROM=noreply@yourapp.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587

# FCM - Firebase Cloud Messaging (for Push Service)
FCM_SERVER_KEY=your-fcm-server-key
FCM_PROJECT_ID=your-firebase-project-id
```

### API Gateway (`services/api-gateway/.env`)

```env
NODE_ENV=development
PORT=3000

# Message Broker
RABBITMQ_URL=amqp://rabbit_user:rabbit_password@rabbitmq:5672

# Cache Store
REDIS_URL=redis://redis:6379

# Service URLs
USER_SERVICE_URL=http://user-service:3001
TEMPLATE_SERVICE_URL=http://template-service:3004

# Security
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

### User Service (`services/user-service/.env`)

```env
NODE_ENV=development
PORT=3001

# Database Connection
DATABASE_URL=postgresql://notif_admin:notif_admin_password@postgres:5432/user_service_db

# Cache Store
REDIS_URL=redis://redis:6379

# Security
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Logging
LOG_LEVEL=info
```

### Template Service (`services/template-service/.env`)

```env
NODE_ENV=development
PORT=3004

# Database Connection
DATABASE_URL=postgresql://notif_admin:notif_admin_password@postgres:5432/template_service_db

# Cache Store
REDIS_URL=redis://redis:6379

# Logging
LOG_LEVEL=info
```

### Production Configuration Checklist

- [ ] Update `JWT_SECRET` with `openssl rand -base64 32`
- [ ] Set `NODE_ENV=production` in all services
- [ ] Configure real SMTP credentials
- [ ] Configure FCM server key
- [ ] Update service URLs to production domains
- [ ] Enable HTTPS/TLS
- [ ] Set strong database passwords
- [ ] Configure monitoring & alerting
- [ ] Set up log aggregation
- [ ] Configure database backups
- [ ] Enable Redis persistence

---

## Development Guide

### Local Development Setup

```bash
# 1. Clone repository
git clone <repository-url>
cd distributed-notification-system

# 2. Install dependencies for all services
npm install --workspace=services/api-gateway
npm install --workspace=services/user-service
npm install --workspace=services/template-service

# 3. Copy environment files
cp .env.example .env
cp services/api-gateway/.env.example services/api-gateway/.env
cp services/user-service/.env.example services/user-service/.env
cp services/template-service/.env.example services/template-service/.env

# 4. Start infrastructure (postgres, redis, rabbitmq)
docker-compose up -d postgres redis rabbitmq

# 5. Wait for healthy status
docker-compose ps

# 6. Start services with auto-reload
# Terminal 1
cd services/api-gateway && npm run dev

# Terminal 2
cd services/user-service && npm run dev

# Terminal 3
cd services/template-service && npm run dev
```

### Project Structure

```
distributed-notification-system/
├── .env                          # Root configuration
├── .env.example                  # Template config
├── .gitignore                    # Git ignore rules
├── docker-compose.yml            # Container orchestration
├── README.md                     # Quick start guide
├── DOCUMENTATION.md              # This file
├── CONTRIBUTING.md               # Contribution guidelines
│
├── infrastructure/               # Infrastructure configs
│   ├── postgres/
│   │   └── init-scripts/
│   │       └── 01-init.sql       # Database initialization
│   └── rabbitmq/
│       └── definitions.json      # RabbitMQ setup
│
├── services/                     # Microservices
│   ├── api-gateway/              # API Gateway
│   │   ├── src/
│   │   │   ├── index.js
│   │   │   ├── services/         # External clients
│   │   │   │   ├── rabbitmq.service.js
│   │   │   │   └── redis.service.js
│   │   │   └── utils/
│   │   │       ├── logger.js
│   │   │       └── circuit-breaker.js
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── .env.example
│   │
│   ├── user-service/             # User Service
│   │   ├── src/
│   │   │   ├── index.js
│   │   │   ├── services/
│   │   │   │   └── redis.service.js
│   │   │   └── utils/
│   │   │       └── logger.js
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── .env.example
│   │
│   └── template-service/         # Template Service
│       ├── src/
│       │   ├── index.js
│       │   ├── services/
│       │   │   └── redis.service.js
│       │   └── utils/
│       │       └── logger.js
│       ├── Dockerfile
│       ├── package.json
│       └── .env.example
│
└── assets/                       # Documentation assets
    └── images/
        └── microservice-architecture.png
```

### Adding New Endpoints

#### Example: Add endpoint to User Service

1. **Edit [`services/user-service/src/index.js`](services/user-service/src/index.js)**:

```javascript
// Add this endpoint
app.patch('/api/v1/users/:user_id/password', {
  onRequest: [app.authenticate],
  schema: {
    description: 'Change user password',
    tags: ['Users'],
    security: [{ bearerAuth: [] }]
  }
}, async (request, reply) => {
  try {
    const { user_id } = request.params;
    const { current_password, new_password } = request.body;

    // Validate input
    if (!current_password || !new_password) {
      return reply.code(400).send({
        success: false,
        data: null,
        error: 'Missing required fields',
        message: 'current_password and new_password required',
        meta: null
      });
    }

    // Get user
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
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

    // Verify current password
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({
        success: false,
        data: null,
        error: 'Invalid password',
        message: 'Current password is incorrect',
        meta: null
      });
    }

    // Hash new password
    const new_hash = await bcrypt.hash(new_password, 10);

    // Update
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [new_hash, user_id]
    );

    reply.send({
      success: true,
      data: { user_id },
      message: 'Password changed successfully',
      meta: null
    });

  } catch (error) {
    logger.error({ error: error.message }, 'Error changing password');
    reply.code(500).send({
      success: false,
      data: null,
      error: error.message,
      message: 'Failed to change password',
      meta: null
    });
  }
});
```

2. **Test the endpoint**:

```bash
# With token from login response
curl -X PATCH http://localhost:3001/api/v1/users/{user_id}/password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "current_password": "old_pass",
    "new_password": "new_pass_123"
  }'
```

### Common Development Tasks

#### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api-gateway
docker-compose logs -f user-service
docker-compose logs -f template-service

# Show last 50 lines
docker-compose logs --tail=50 -f api-gateway
```

#### Reset All Data
```bash
# Stop and remove all containers and volumes
docker-compose down -v

# Restart everything (databases reinitialize)
docker-compose up -d
```

#### Access Database
```bash
# Connect to PostgreSQL
psql postgresql://notif_admin:notif_admin_password@localhost:5432/user_service_db

# Some useful queries
\dt                     # List tables
\d users               # Describe users table
SELECT * FROM users;   # View users
```

#### Monitor RabbitMQ
1. Visit http://localhost:15672
2. Login: `rabbit_user` / `rabbit_password`
3. View:
   - **Queues** tab - Message counts
   - **Connections** tab - Active connections
   - **Channels** tab - Open channels

#### Monitor Redis
```bash
# Connect to Redis CLI
redis-cli

# Useful commands
PING                   # Test connection
KEYS *                 # List all keys
GET key_name          # Get value
DEL key_name          # Delete key
FLUSHDB              # Clear database
INFO                 # Server info
```

---

## Deployment

### Production Checklist

Before deploying to production:

- [ ] **Security**
  - Change `JWT_SECRET`
  - Update database passwords
  - Enable HTTPS/TLS
  - Configure firewall rules
  - Set up WAF (Web Application Firewall)

- [ ] **Database**
  - Set up automated backups
  - Enable point-in-time recovery
  - Configure replica for HA
  - Monitor disk space

- [ ] **Caching**
  - Enable Redis persistence
  - Configure maxmemory policy
  - Set up Redis sentinel

- [ ] **Message Queue**
  - Enable RabbitMQ clustering
  - Configure queue replication
  - Set up monitoring

- [ ] **Monitoring & Logging**
  - Centralize logs (ELK, Splunk)
  - Set up performance monitoring
  - Configure alerting
  - Create dashboards

- [ ] **Deployment**
  - Use container orchestration (Kubernetes)
  - Set up CI/CD pipeline
  - Configure auto-scaling
  - Plan rollback strategy

### Docker Build & Deploy

```bash
# Build images
docker-compose build

# Tag for registry
docker tag distributed-notification-system-api-gateway:latest \
  registry.example.com/notification-api-gateway:1.0.0

# Push to registry
docker push registry.example.com/notification-api-gateway:1.0.0
```

### Kubernetes Deployment

```bash
# Create namespace
kubectl create namespace notifications

# Apply manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/rabbitmq.yaml
kubectl apply -f k8s/services.yaml
kubectl apply -f k8s/deployments.yaml

# Verify
kubectl get pods -n notifications
kubectl logs -f deployment/api-gateway -n notifications
```

---

## Troubleshooting

### Connection Issues

#### Services Won't Start
```bash
# Check Docker status
docker ps -a

# View service logs
docker-compose logs postgres
docker-compose logs rabbitmq
docker-compose logs redis

# Restart specific service
docker-compose restart postgres

# Rebuild and restart
docker-compose up -d --build postgres
```

#### "Connection refused" errors
```bash
# Verify services are running
docker-compose ps

# Check service health
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3004/health

# Check ports are available
netstat -an | grep 3000  # Check port 3000
```

### Database Issues

#### Migration Errors
```bash
# View postgres logs
docker-compose logs postgres

# Manually run init script
docker exec notification-postgres psql -U notif_admin -f /docker-entrypoint-initdb.d/01-init.sql

# Reset and reinitialize
docker-compose down -v
docker-compose up -d postgres
```

#### "too many connections" error
```sql
-- Check connections
SELECT count(*) FROM pg_stat_activity;

-- Kill idle connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' 
AND query_start < now() - interval '5 minutes';

-- View connection limit
SHOW max_connections;
```

### RabbitMQ Issues

#### Can't connect to RabbitMQ
```bash
# Check RabbitMQ logs
docker-compose logs rabbitmq

# Verify it's responding
curl http://localhost:15672/api/health

# Restart
docker-compose restart rabbitmq
```

#### Queues not processing
```bash
# Check RabbitMQ admin
# Visit http://localhost:15672

# Check queue depths and messages
# Check if consumers are connected
# Verify bindings are correct

# Clear dead messages
# In RabbitMQ UI: Go to Queues > Purge
```

### Redis Issues

#### Redis connection timeout
```bash
# Test connection
redis-cli ping

# Check Redis logs
docker-compose logs redis

# Monitor memory usage
redis-cli INFO memory

# Restart
docker-compose restart redis
```

#### High memory usage
```bash
# Check keys
redis-cli KEYS '*'

# Check size
redis-cli DBSIZE

# Set eviction policy (production)
# redis.conf: maxmemory-policy allkeys-lru
```

### JWT Token Issues

#### "Invalid token" errors
```
Solutions:
1. Verify JWT_SECRET is same across services
2. Check token hasn't expired (default 24h)
3. Ensure proper Bearer format: "Bearer <token>"
4. Re-login to get fresh token
```

### Performance Issues

#### Slow Response Times
```bash
# Check metrics
curl http://localhost:3000/api/v1/metrics/

# Monitor queue depths
# Check circuit breaker state
# Monitor database query performance

# Check indexes
SELECT * FROM pg_indexes WHERE tablename = 'users';

# Monitor Redis memory
redis-cli INFO memory

# Check service resource usage
docker stats
```

#### High CPU Usage
```bash
# Identify problematic service
docker stats

# Check logs for errors
docker-compose logs --tail=100 api-gateway

# Review recent code changes

# Check for infinite loops or memory leaks
```

---

## Performance & Monitoring

### Metrics Endpoint

```bash
curl http://localhost:3000/api/v1/metrics/
```

**Response includes**:
- Queue depths (email, push, failed)
- Circuit breaker states
- System timestamp

### Health Checks

**API Gateway**:
```bash
curl http://localhost:3000/health
```

**User Service**:
```bash
curl http://localhost:3001/health
```

**Template Service**:
```bash
curl http://localhost:3004/health
```

Each returns:
- Overall service status
- Database health
- Redis health

### Performance Tips

1. **Caching**
   - Template Service caches for 1 hour
   - API Gateway uses idempotency checks
   - Consider implementing query result caching

2. **Database**
   - Use indexes on frequently queried fields
   - Monitor slow query logs
   - Regular VACUUM and ANALYZE

3. **Message Queue**
   - Monitor queue depths
   - Ensure consumers are running
   - Implement backpressure for high volume

4. **Rate Limiting**
   - Default: 100 requests/minute
   - Adjust in API Gateway based on needs
   - Implement user-specific limits

5. **Circuit Breaker**
   - Prevents cascading failures
   - Default: 5 failures to open
   - Automatic recovery after 30 seconds

### Scaling Strategies

1. **Horizontal Scaling**
   - Run multiple service instances
   - Use load balancer
   - Share PostgreSQL/Redis/RabbitMQ

2. **Vertical Scaling**
   - Increase service resources
   - Database optimization
   - More RAM/CPU

3. **Database**
   - Read replicas for queries
   - Connection pooling
   - Partitioning by time or user

4. **Message Queue**
   - Multiple consumer instances
   - Queue prioritization
   - DLQ monitoring

---

## Support & Contribution

### Getting Help

1. **Check Logs**:
   ```bash
   docker-compose logs -f <service_name>
   ```

2. **API Documentation**:
   - Visit http://localhost:3000/docs (Swagger UI)
   - View each service's `/docs` endpoint

3. **Health Endpoints**:
   - Verify all services are healthy
   - Check database/Redis/RabbitMQ connections

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development workflow
- Pull request process
- Code standards
- Commit conventions

### Team Responsibilities

- **Member 1** (Infrastructure + API Gateway)
  - [`services/api-gateway`](services/api-gateway)
  - Infrastructure setup
  - Docker & deployment

- **Member 2** (User Service)
  - [`services/user-service`](services/user-service)
  - User management
  - Authentication

- **Member 3** (Email + Push Services)
  - Email consumer implementation
  - Push notification consumer
  - SMTP & FCM integration

- **Member 4** (Template Service + DevOps)
  - [`services/template-service`](services/template-service)
  - DevOps & deployment
  - Monitoring setup

---

## Additional Resources

- [Fastify Documentation](https://www.fastify.io/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [RabbitMQ Documentation](https://www.rabbitmq.com/documentation.html)
- [Redis Documentation](https://redis.io/documentation)
- [Docker Documentation](https://docs.docker.com/)

---

**Last Updated**: November 2025  
**Version**: 1.0.0  
**License**: MIT

For questions or issues, please contact the team or create an issue in the repository.