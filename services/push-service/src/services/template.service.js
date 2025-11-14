const axios = require('axios');
const Handlebars = require('handlebars');
const logger = require('../utils/logger');

class TemplateService {
  constructor() {
    this.base_url = process.env.TEMPLATE_SERVICE_URL || 'http://localhost:3004';
    this.cache = new Map();
  }

  async get_template(template_code) {
    try {
      if (this.cache.has(template_code)) {
        return this.cache.get(template_code);
      }

      const response = await axios.get(
        `${this.base_url}/api/v1/templates/by-name/${template_code}`
      );
      const template = response.data.data;

      this.cache.set(template_code, template);
      return template;
    } catch (error) {
      logger.error(`Error fetching template ${template_code}:`, error.message);
      throw error;
    }
  }

  async render(template, variables) {
    try {
      const subject_template = Handlebars.compile(template.subject || '');
      const body_template = Handlebars.compile(template.body);

      return {
        subject: subject_template(variables),
        body: body_template(variables)
      };
    } catch (error) {
      logger.error('Error rendering template:', error.message);
      throw error;
    }
  }
}

module.exports = new TemplateService();