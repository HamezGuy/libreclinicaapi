import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.test if USE_TEST_ENV is set or .env.test exists
const testEnvPath = path.resolve(__dirname, '..', '.env.test');
const defaultEnvPath = path.resolve(__dirname, '..', '.env');
const fs = require('fs');
dotenv.config({ path: fs.existsSync(testEnvPath) && process.env.USE_TEST_ENV !== 'false' ? testEnvPath : defaultEnvPath });

export const CONFIG = {
  BASE_URL: process.env.BASE_URL || 'http://localhost:3100/api',

  ADMIN_EMAILS: [
    process.env.ADMIN_EMAIL || 'jamesgui111@gmail.com',
    process.env.ADMIN_EMAIL_2 || 'jamesgui222@gmail.com',
    process.env.ADMIN_EMAIL_3 || 'jamesgui333@gmail.com',
  ],
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Test1234!@',

  ORG_BASE_NAME: 'AccuraTrial Test Org',
  ORG_TYPE: 'research_institution' as const,

  MEMBER1: {
    firstName: 'Sarah',
    lastName: 'Coordinator',
    username: 'testcoordinator1',
    email: 'testcoordinator1@accuratrials.com',
    password: 'Test1234!@',
    role: 'coordinator',
  },
  MEMBER2: {
    firstName: 'Michael',
    lastName: 'Monitor',
    username: 'testmonitor1',
    email: 'testmonitor1@accuratrials.com',
    password: 'Test1234!@',
    role: 'monitor',
  },
};
