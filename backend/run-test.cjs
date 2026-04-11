#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const outFile = 'C:/temp/vitest_decision_out.txt';

const result = execSync(
  `node "${path.join(process.cwd(), 'node_modules/vitest/vitest.mjs')}" run --config vitest.repo.config.ts tests/repositories/decision-repo.test.ts`,
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

fs.writeFileSync(outFile, result, 'utf8');
console.log('Written to', outFile);
console.log(result);
