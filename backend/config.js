const path = require('path');

const isDocker = process.env.DOCKER_ENV === 'true' || require('fs').existsSync('/.dockerenv');

const baseDir = isDocker ? '/app' : path.resolve(__dirname, '..');

module.exports = {
  INCOME_THRESHOLD: parseInt(process.env.INCOME_THRESHOLD) || 800,
  PORT: parseInt(process.env.PORT) || 3000,
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(baseDir, 'uploads'),
  DB_PATH: process.env.DB_PATH || path.join(baseDir, 'data', 'subsidy.db')
};
