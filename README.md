# Distributed Notification System

Microservices-based notification system with email and push notifications.

## Team Members
- Member 1: Infrastructure + API Gateway (@teammate1)
- Member 2: User Service (@teammate2)
- Member 3: Email + Push Services (@teammate3)
- Member 4: Template Service + DevOps (@teammate4)

## Quick Start
```bash
# 1. Start infrastructure
docker-compose up -d

# 2. Check services
docker-compose ps

# 3. Access services
# - API Gateway: http://localhost:3000
# - RabbitMQ UI: http://localhost:15672 (rabbit_user/rabbit_password)
# - PostgreSQL: localhost:5432
```

## Architecture

- 5 Microservices (API Gateway, User, Email, Push, Template)
- PostgreSQL (3 databases)
- RabbitMQ (Message queue with DLQ)
- Redis (Cache)

---

## Microservice Architecture Diagram

![Microservice Architecture Diagram](assets/images/microservice-architecture.png)


---

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

---

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

## Development

See CONTRIBUTING.md for stacked PRs workflow.