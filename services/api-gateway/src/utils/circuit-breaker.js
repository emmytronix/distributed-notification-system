const logger = require('./logger');

class CircuitBreaker {
  constructor() {
    this.circuits = {};
    this.default_options = {
      failure_threshold: 5,
      success_threshold: 2,
      timeout: 60000,
      reset_timeout: 30000
    };
  }

  init_circuit(name, options = {}) {
    if (!this.circuits[name]) {
      this.circuits[name] = {
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        next_attempt: Date.now(),
        options: { ...this.default_options, ...options }
      };
    }
    return this.circuits[name];
  }

  async execute(name, fn, fallback = null) {
    const circuit = this.init_circuit(name);

    if (circuit.state === 'OPEN') {
      if (Date.now() < circuit.next_attempt) {
        logger.warn(`Circuit ${name} is OPEN. Using fallback.`);
        
        if (fallback) {
          return await fallback();
        }
        throw new Error(`Circuit ${name} is OPEN`);
      }
      
      circuit.state = 'HALF_OPEN';
      circuit.successes = 0;
      logger.info(`Circuit ${name} moving to HALF_OPEN state`);
    }

    try {
      const result = await this.execute_with_timeout(fn, circuit.options.timeout);
      return this.on_success(name, result);
    } catch (error) {
      return this.on_failure(name, error, fallback);
    }
  }

  async execute_with_timeout(fn, timeout) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Operation timeout')), timeout)
      )
    ]);
  }

  on_success(name, result) {
    const circuit = this.circuits[name];

    if (circuit.state === 'HALF_OPEN') {
      circuit.successes++;
      
      if (circuit.successes >= circuit.options.success_threshold) {
        circuit.state = 'CLOSED';
        circuit.failures = 0;
        circuit.successes = 0;
        logger.info(`Circuit ${name} closed after successful attempts`);
      }
    } else {
      circuit.failures = 0;
    }

    return result;
  }

  async on_failure(name, error, fallback) {
    const circuit = this.circuits[name];
    circuit.failures++;

    logger.error(`Circuit ${name} failure (${circuit.failures}/${circuit.options.failure_threshold}):`, error.message);

    if (circuit.failures >= circuit.options.failure_threshold) {
      circuit.state = 'OPEN';
      circuit.next_attempt = Date.now() + circuit.options.reset_timeout;
      logger.error(`Circuit ${name} opened due to repeated failures`);
    }

    if (fallback) {
      return await fallback();
    }

    throw error;
  }

  getStats() {
    const stats = {};
    for (const [name, circuit] of Object.entries(this.circuits)) {
      stats[name] = {
        state: circuit.state,
        failures: circuit.failures,
        successes: circuit.successes
      };
    }
    return stats;
  }
}

module.exports = new CircuitBreaker();