const logger = require('../utils/logger');

class RetryService {
  constructor() {
    this.max_retries = parseInt(process.env.MAX_RETRIES) || 3;
    this.base_delay = parseInt(process.env.RETRY_BASE_DELAY) || 1000;
  }

  async should_retry(message) {
    const retry_count = message.retry_count || 0;
    return retry_count < this.max_retries;
  }

  calculate_delay(retry_count) {
    return this.base_delay * Math.pow(2, retry_count);
  }

  async schedule_retry(message) {
    const retry_count = (message.retry_count || 0) + 1;
    const delay = this.calculate_delay(retry_count);

    message.retry_count = retry_count;
    message.scheduled_for = Date.now() + delay;

    logger.info({
      request_id: message.request_id,
      retry_count,
      delay
    }, 'Scheduling retry');

    const rabbitmq_service = require('./rabbitmq.service');
    
    setTimeout(async () => {
      await rabbitmq_service.publish('notifications.direct', 'email', message);
    }, delay);

    return true;
  }
}

module.exports = new RetryService();