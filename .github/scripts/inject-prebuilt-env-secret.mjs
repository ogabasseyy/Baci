#!/usr/bin/env node
// Ensure a single key is present in a Vercel-pulled dotenv file so the local
// prebuilt `vercel build` passes env.ts's build-time presence validation for a
// *sensitive* (write-only) Vercel env var — which `vercel pull` redacts as
// `KEY=""` or, since CLI 57, `KEY="[SENSITIVE]"`. The value is consumed only at
// RUNTIME, where Vercel injects the real value and env.ts re-validates it.
// The injected key is
// server-only (not `NEXT_PUBLIC_`), so it is never bundled client-side.
//
// Usage: node inject-prebuilt-env-secret.mjs <KEY> <ENV_FILE> [STANDIN]
//   process.env[<KEY>]  real value (for example, a GitHub Actions secret). If
//                       non-empty, it is injected unconditionally.
//   [STANDIN]           optional build-time stand-in. Used only when the real
//                       value is empty and Vercel pulled exactly one explicitly
//                       blank `<KEY>=`, `<KEY>=''`, or `<KEY>=""` entry, or
//                       the exact CLI marker `<KEY>="[SENSITIVE]"`.
//   --generate-es256-jwk-standin
//                       generate an ephemeral ES256 private JWK only after the
//                       same redaction check. When the optional key is
//                       absent, leave the file unchanged so production can use
//                       the configured legacy signing-secret fallback. The JWK
//                       is written directly to the pulled file and is never
//                       logged or passed as an arg.
// No-op (exit 0) when neither a real value nor stand-in mode is provided, so
// deploys with nothing configured (for example quiz phase "1a") are unaffected.

import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';

const { processEnv, resetEnv } = nextEnv;

const GENERATED_ES256_JWK_STANDIN = '--generate-es256-jwk-standin';
const GENERATED_ES256_JWK_STANDIN_KID = 'baci-build-only-es256-jwk-standin';
const LEGACY_SUPABASE_JWT_SECRET = 'SUPABASE_JWT_SECRET';
const dotenvAssignmentPattern = /^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/;

const [key, file, standinArg, ...extraArgs] = process.argv.slice(2);

if (!key || !file || extraArgs.length > 0) {
  console.error('Usage: inject-prebuilt-env-secret.mjs <KEY> <ENV_FILE> [STANDIN]');
  process.exit(2);
}

function findDotenvAssignments(lines, targetKey) {
  return lines.flatMap((line, index) => {
    const parsedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
    const match = parsedLine.match(dotenvAssignmentPattern);
    if (!match || match[1] !== targetKey) return [];
    return [{ index, value: match[2] }];
  });
}

function isRedactedDotenvValue(value) {
  return (
    value === '' || value === "''" || value === '""' || value === '"[SENSITIVE]"'
  );
}

function readExpandedDotenvValue(contents, file, targetKey) {
  const originalValue = process.env[targetKey];
  delete process.env[targetKey];

  try {
    const [, parsed] = processEnv(
      [{ path: file, contents, env: {} }],
      path.dirname(file),
      { error() {} },
      true,
    );
    return parsed[targetKey];
  } finally {
    resetEnv();
    if (originalValue === undefined) delete process.env[targetKey];
    else process.env[targetKey] = originalValue;
  }
}

function hasUnresolvedDotenvReference(rawValue, lines) {
  const referencePattern = /(?<!\\)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
  return [...rawValue.matchAll(referencePattern)].some((match) => {
    const referencedKey = match[1] ?? match[2];
    return (
      process.env[referencedKey] === undefined &&
      findDotenvAssignments(lines, referencedKey).length === 0
    );
  });
}

const realValue = process.env[key];
const hasRealValue = realValue !== undefined && realValue !== '';
const usingStandin =
  !hasRealValue && standinArg !== undefined && standinArg !== '';
const usingGeneratedStandin =
  usingStandin && standinArg === GENERATED_ES256_JWK_STANDIN;

if (!usingStandin && !hasRealValue) {
  console.log(`${key} not present in environment; leaving ${file} unchanged.`);
  process.exit(0);
}

if (!fs.existsSync(file)) {
  console.error(
    `${file} does not exist; expected the "vercel pull" step to create it before injection.`,
  );
  process.exit(1);
}

const contents = fs.readFileSync(file, 'utf8');
const lines = contents.split('\n');
const assignments = findDotenvAssignments(lines, key);

if (usingGeneratedStandin && assignments.length === 0) {
  const legacyAssignments = findDotenvAssignments(lines, LEGACY_SUPABASE_JWT_SECRET);
  const hasUnresolvedReference =
    legacyAssignments.length === 1 &&
    hasUnresolvedDotenvReference(legacyAssignments[0].value, lines);
  const legacyValue =
    legacyAssignments.length === 1
      ? readExpandedDotenvValue(contents, file, LEGACY_SUPABASE_JWT_SECRET)?.trim()
      : undefined;
  if (
    legacyAssignments.length !== 1 ||
    hasUnresolvedReference ||
    legacyValue === undefined ||
    legacyValue === ''
  ) {
    const legacyState =
      legacyAssignments.length === 0
        ? 'absent'
        : legacyAssignments.length > 1
          ? 'ambiguous'
          : hasUnresolvedReference
            ? 'an unresolved interpolation'
          : 'empty';
    console.error(
      `${key} and its ${LEGACY_SUPABASE_JWT_SECRET} fallback cannot be verified in ${file}: ` +
        `the fallback is ${legacyState}. Refusing to continue without signing material.`,
    );
    process.exit(1);
  }

  console.log(
    `${key} is absent from ${file}; verified the legacy signing-secret fallback assignment.`,
  );
  process.exit(0);
}

// A stand-in may only substitute for Vercel's exact write-only placeholders.
// Refusing absent, duplicated, non-redacted, or malformed-looking entries avoids
// replacing a value that Vercel pull did expose or an opaque dotenv construct.
if (
  usingStandin &&
  (assignments.length !== 1 || !isRedactedDotenvValue(assignments[0].value))
) {
  const state =
    assignments.length === 0
      ? 'absent'
      : assignments.length > 1
        ? 'ambiguous'
        : 'not explicitly blank or a recognized sensitive marker';
  console.error(
    `${key} is ${state} in ${file}. Refusing to replace it with a build-time ` +
      'stand-in; configure Vercel with a write-only sensitive value or provide a real value.',
  );
  process.exit(1);
}

let value;
let injectionMode;
if (usingGeneratedStandin) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateJwk = privateKey.export({ format: 'jwk' });
  value = JSON.stringify({
    ...privateJwk,
    alg: 'ES256',
    kid: GENERATED_ES256_JWK_STANDIN_KID,
  });
  injectionMode = 'generated ES256 build-time stand-in';
} else if (usingStandin) {
  value = standinArg;
  injectionMode = 'build-time stand-in';
} else {
  value = realValue;
  injectionMode = 'configured value';
}

// dotenv values are normally written as KEY="value" and then parsed by
// @next/env, which runs dotenv-expand. That format cannot safely carry a JSON
// JWK: its double quotes would terminate the value. A single-quoted dotenv
// value preserves JSON's double quotes. We still refuse apostrophes,
// backslashes, dollar signs, and line breaks because this small injector
// deliberately supports only simple scalar secrets and compact JWK JSON, not
// an arbitrary dotenv serializer.
const requiresSingleQuotes = value.includes('"');
if (/['\\$\r\n]/.test(value)) {
  console.error(
    `${key} contains an apostrophe, backslash, dollar sign, CR, or LF that cannot ` +
      `be safely written to ${file}. Use compact JSON or a simple scalar value.`,
  );
  process.exit(1);
}

const assignmentIndexes = new Set(assignments.map((assignment) => assignment.index));
const kept = lines.filter((_, index) => !assignmentIndexes.has(index));
// Drop trailing blank lines so repeated runs do not accumulate them.
while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
kept.push(`${key}=${requiresSingleQuotes ? `'${value}'` : `"${value}"`}`);

fs.writeFileSync(file, `${kept.join('\n')}\n`);
console.log(
  `Injected ${key} into ${file} (${injectionMode}, length ${value.length}).`,
);
