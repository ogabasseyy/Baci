#!/usr/bin/env node
// If a required sensitive Production key is missing from `vercel pull` output,
// create it once through the Vercel REST API and record the blank placeholder so
// the presence assert can pass. Pinned CLI 57.0.0 `env add --sensitive` can exit 0
// after storing an empty stdin/--value write, so this path never uses the CLI.
// Never logs, parses, or prints the generated value.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERCEL_API_ORIGIN = 'https://api.vercel.com';
const [key, file, ...extraArgs] = process.argv.slice(2);

if (
  !key ||
  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
  !file ||
  extraArgs.length > 0
) {
  console.error('Usage: ensure-vercel-sensitive-env.mjs <KEY> <ENV_FILE>');
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

class ClosedFailure extends Error {}

function failClosed(message = `Failed to create ${key} in Vercel Production.`) {
  throw new ClosedFailure(message);
}

const secret = randomBytes(32).toString('hex');
if (secret.length < 32) {
  console.error(`Failed to generate a ${key} value.`);
  process.exit(1);
}

try {
  await createSensitiveProductionEnv(key, secret);
} catch (error) {
  console.error(
    error instanceof ClosedFailure
      ? error.message
      : `Failed to create ${key} in Vercel Production.`,
  );
  process.exit(1);
}

const suffix = fileContents.endsWith('\n') || fileContents.length === 0 ? '' : '\n';
fs.writeFileSync(file, `${fileContents}${suffix}${key}=""\n`);
console.log(
  `${key} was missing from the pulled Production environment and has been created as a sensitive Vercel Production value.`,
);

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function sameDigest(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function resolveApiOrigin() {
  const override = process.env.BACI_VERCEL_API_ORIGIN;
  if (!override) return VERCEL_API_ORIGIN;

  let parsed;
  try {
    parsed = new URL(override);
  } catch {
    failClosed('Refusing an invalid Vercel API origin override.');
  }

  if (
    parsed.hostname !== '127.0.0.1' ||
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
  ) {
    failClosed('Refusing a non-loopback Vercel API origin override.');
  }

  return parsed.origin;
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    failClosed(`Missing ${name} for sensitive Production env creation.`);
  }
  return value;
}

function requirePathId(name) {
  const value = requireEnv(name);
  if (/[/?#&=]/.test(value)) {
    failClosed(`Invalid ${name} for sensitive Production env creation.`);
  }
  return value;
}

function containsSecret(haystack, value) {
  return typeof haystack === 'string' && haystack.includes(value);
}

function asRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.created)) return payload.created;
  if (Array.isArray(payload.envs)) return payload.envs;
  if (payload.created && typeof payload.created === 'object') {
    return [payload.created];
  }
  return [payload];
}

function productionSensitiveRecord(row, expectedKey) {
  if (!row || typeof row !== 'object') return false;
  if (row.key !== expectedKey || row.type !== 'sensitive') return false;
  if (typeof row.id !== 'string' || row.id.length === 0) return false;
  if (typeof row.value === 'string' && row.value.length > 0) return false;
  return (
    row.target === 'production' ||
    (Array.isArray(row.target) && row.target.includes('production'))
  );
}

async function readResponseText(response, envKey, value) {
  const text = await response.text();
  if (containsSecret(text, value)) {
    failClosed(`Vercel reflected ${envKey}; refusing to continue.`);
  }
  return text;
}

async function createSensitiveProductionEnv(envKey, value) {
  const origin = resolveApiOrigin();
  const token = requireEnv('VERCEL_TOKEN');
  const projectId = requirePathId('VERCEL_PROJECT_ID');
  const teamId = requirePathId('VERCEL_ORG_ID');
  const tempFile = path.join(
    os.tmpdir(),
    `baci-vercel-env-${randomBytes(16).toString('hex')}`,
  );

  try {
    fs.writeFileSync(tempFile, value, { encoding: 'utf8', mode: 0o600 });
    const fromFile = fs.readFileSync(tempFile, 'utf8');
    if (!sameDigest(digest(value), digest(fromFile))) {
      failClosed(`Failed to confirm the generated ${envKey} write path.`);
    }

    const createUrl = new URL(`/v10/projects/${projectId}/env`, origin);
    createUrl.searchParams.set('teamId', teamId);
    const createdResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key: envKey,
        value: fromFile,
        type: 'sensitive',
        target: ['production'],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const createdText = await readResponseText(createdResponse, envKey, value);
    if (!createdResponse.ok) failClosed();

    let createdPayload;
    try {
      createdPayload = JSON.parse(createdText);
    } catch {
      failClosed();
    }

    const created = asRecords(createdPayload).filter((row) =>
      productionSensitiveRecord(row, envKey),
    );
    if (created.length !== 1) {
      failClosed(`Failed to confirm ${envKey} in Vercel Production.`);
    }

    const listUrl = new URL(`/v10/projects/${projectId}/env`, origin);
    listUrl.searchParams.set('teamId', teamId);
    const listedResponse = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const listedText = await readResponseText(listedResponse, envKey, value);
    if (!listedResponse.ok) {
      failClosed(`Failed to confirm ${envKey} in Vercel Production.`);
    }

    let listedPayload;
    try {
      listedPayload = JSON.parse(listedText);
    } catch {
      failClosed(`Failed to confirm ${envKey} in Vercel Production.`);
    }

    const listed = asRecords(listedPayload).filter((row) => row?.key === envKey);
    if (listed.length !== 1 || !productionSensitiveRecord(listed[0], envKey)) {
      failClosed(`Failed to confirm ${envKey} in Vercel Production.`);
    }
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // The generated value must not remain on disk after the confirmed write.
    }
  }
}
