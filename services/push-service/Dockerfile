FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache wget

# Copy package files with correct ownership
COPY --chown=nodejs:nodejs package*.json ./

# Install dependencies as root (safe)
RUN npm ci --only=production

# Create user & group BEFORE copying the rest of the files
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001

# Copy the entire app with correct ownership (NO chown -R)
COPY --chown=nodejs:nodejs . .

USER nodejs

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3003/health || exit 1

CMD ["node", "src/index.js"]
