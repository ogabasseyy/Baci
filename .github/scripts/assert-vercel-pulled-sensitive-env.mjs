#!/usr/bin/env node
// Vercel intentionally writes sensitive runtime values as blank assignments in
// `vercel pull` output. This asserts only that a required key is defined once;
// it never parses, returns, or logs the value.

import fs from 'node:fs';

const [key, file, ...extraArgs] = process.argv.slice(2);

if (
  !key ||
  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
  !file ||
  extraArgs.length > 0
) {
  console.error('Usage: assert-vercel-pulled-sensitive-env.mjs <KEY> <ENV_FILE>');
  process.exit(2);
}

if (!fs.existsSync(file)) {
  console.error(`${file} does not exist; expected the Vercel pull step to create it.`);
  process.exit(1);
}

const assignmentPattern = new RegExp(`^(?:export[ \\t]+)?${key}[ \\t]*=`);
const assignmentCount = fs
  .readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => {
    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    return assignmentPattern.test(normalizedLine);
  })
  .length;

if (assignmentCount === 0) {
  console.error(
    `${key} is absent from ${file}. Configure this sensitive runtime key in Vercel Production before deploying.`,
  );
  process.exit(1);
}

if (assignmentCount > 1) {
  console.error(`${key} is ambiguous in ${file}; expected exactly one assignment.`);
  process.exit(1);
}

console.log(`${key} is present in the pulled Vercel Production environment.`);
