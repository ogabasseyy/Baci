#!/usr/bin/env node
// If a required sensitive Production key is missing from `vercel pull` output,
// create it once in Vercel Production and record the blank placeholder so the
// presence assert can pass. Never logs, parses, or prints the generated value.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const [key, file, wrapper, ...extraArgs] = process.argv.slice(2);

if (
  !key ||
  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
  !file ||
  !wrapper ||
  extraArgs.length > 0
) {
  console.error(
    'Usage: ensure-vercel-sensitive-env.mjs <KEY> <ENV_FILE> <VERCEL_WRAPPER>',
  );
  process.exit(2);
}

if (!fs.existsSync(file)) {
  console.error(
    `${file} does not exist; expected the Vercel pull step to create it.`,
  );
  process.exit(1);
}

const assignmentPattern = new RegExp(`^(?:export[ \\t]+)?${key}[ \\t]*=`);
const fileContents = fs.readFileSync(file, 'utf8');
const assignmentCount = fileContents.split('\n').filter((line) => {
  const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
  return assignmentPattern.test(normalizedLine);
}).length;

if (assignmentCount > 1) {
  console.error(`${key} is ambiguous in ${file}; expected exactly one assignment.`);
  process.exit(1);
}

if (assignmentCount === 1) {
  console.log(
    `${key} is already defined in the pulled Vercel Production environment.`,
  );
  process.exit(0);
}

const secret = randomBytes(32).toString('hex');
if (secret.length < 32) {
  console.error(`Failed to generate a ${key} value.`);
  process.exit(1);
}

const result = spawnSync(
  wrapper,
  ['env', 'add', key, 'production', '--sensitive', '--yes'],
  {
    encoding: 'utf8',
    input: secret,
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);

if (result.status !== 0) {
  console.error(`Failed to create ${key} in Vercel Production.`);
  process.exit(1);
}

const suffix = fileContents.endsWith('\n') || fileContents.length === 0 ? '' : '\n';
fs.writeFileSync(file, `${fileContents}${suffix}${key}=""\n`);
console.log(
  `${key} was missing from the pulled Production environment and has been created as a sensitive Vercel Production value.`,
);
