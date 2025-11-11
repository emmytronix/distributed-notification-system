-- Database per service pattern

-- 1. USER SERVICE DATABASE
CREATE DATABASE user_service_db;
\c user_service_db;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    email_enabled BOOLEAN DEFAULT true,
    push_enabled BOOLEAN DEFAULT true,
    notification_frequency VARCHAR(50) DEFAULT 'immediate',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

CREATE TABLE push_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    device_type VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_push_tokens_user_id ON push_tokens(user_id);

-- Sample user
INSERT INTO users (email, username, password_hash, first_name, last_name, is_verified) VALUES
('test@example.com', 'testuser', '$2b$10$rKvLhPZvx9J7OYqLMBhzuewYZKKPq5Z7fKJ6yW5xZj5JQ5vRZ3yDC', 'Test', 'User', true);

INSERT INTO user_preferences (user_id, email_enabled, push_enabled) 
SELECT id, true, true FROM users WHERE email = 'test@example.com';


-- 2. TEMPLATE SERVICE DATABASE
\c postgres;
CREATE DATABASE template_service_db;
\c template_service_db;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    subject VARCHAR(255),
    body TEXT NOT NULL,
    variables JSONB,
    language VARCHAR(10) DEFAULT 'en',
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE template_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID REFERENCES templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    subject VARCHAR(255),
    body TEXT NOT NULL,
    variables JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(template_id, version)
);

CREATE INDEX idx_templates_name ON templates(name);

-- Sample templates
INSERT INTO templates (name, type, subject, body, variables) VALUES
('welcome_email', 'email', 'Welcome to {{app_name}}!', 
 'Hello {{name}}, Welcome to {{app_name}}!', 
 '{"name": "string", "app_name": "string"}'),
('password_reset', 'email', 'Reset Your Password', 
 'Hi {{name}}, Reset link: {{reset_link}}', 
 '{"name": "string", "reset_link": "string"}');


-- 3. NOTIFICATION LOGS DATABASE (Shared)
\c postgres;
CREATE DATABASE notification_logs_db;
\c notification_logs_db;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id VARCHAR(100) UNIQUE NOT NULL,
    notification_id VARCHAR(100) UNIQUE NOT NULL,
    user_id UUID NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    template_code VARCHAR(100),
    recipient VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notification_logs_request_id ON notification_logs(request_id);
CREATE INDEX idx_notification_logs_status ON notification_logs(status);