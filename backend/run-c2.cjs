#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

const result = execSync(
  `node "${path.join(process.cwd(), 'node_modules/vitest/vitest.mjs')}" run --config vitest.repo.config.ts tests/features/feedback-collector.test.ts`,
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

process.stdout.write(result);
