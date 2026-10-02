#!/usr/bin/env node
// Fail closed when a pulled Preview env file exposes an unexpected
// non-blank server-side value to the untrusted build job.
//
// Allowed without review: NEXT_PUBLIC_* keys (public by definition),
// blank assignments (sensitive-marked keys arrive blank after the
// normalize step), and keys named in the allowlist file (one per line,
// `#` comments). Everything else fails, printing KEY NAMES ONLY so a
// failure can never echo a secret into the logs.
//
// The allowlist grandfathers today's Preview inventory; its value is the
// ratchet: any future server key added without the sensitive flag breaks
// the workflow loudly instead of leaking silently to branch builds.
// dotenv subset: single-line KEY=VALUE assignments. Unparseable lines
// fail closed (pulled files are machine-generated and clean).
import { readFileSync } from 'node:fs';

const [envFile, allowlistFile] = process.argv.slice(2);
if (!envFile || !allowlistFile) {
  console.error('Usage: assert-preview-env-allowlist.mjs <env-file> <allowlist-file>');
  process.exit(2);
}

let envText;
let allowText;
try {
  envText = readFileSync(envFile, 'utf8');
  allowText = readFileSync(allowlistFile, 'utf8');
} catch (error) {
  console.error(`Cannot read input: ${error.message}`);
  process.exit(2);
}

const allowed = new Set(
  allowText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#')),
);

const isBlankValue = (value) =>
  value === '' || value === '""' || value === "''";

// Allowlisted *_URL values must stay credential-free endpoints: reject
// userinfo (user:pass@host) and query strings (?token=). A future legit
// query-bearing URL fails loud with a review path instead of leaking.
const hasUserinfoCredential = (value) => /:\/\/[^/\s"']*@/.test(value);
const hasEmbeddedCredential = (value) =>
  hasUserinfoCredential(value) || value.includes('?');

const offenders = [];
const unparseable = [];
const tainted = [];
const taintedPublic = [];
envText.split('\n').forEach((rawLine, index) => {
  const line = rawLine.trim();
  if (line === '' || line.startsWith('#')) {
    return;
  }
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (!match) {
    // Line number only: the content could be a secret fragment.
    unparseable.push(index + 1);
    return;
  }
  const [, key, rawValue] = match;
  if (key.startsWith('NEXT_PUBLIC_') || allowed.has(key)) {
    // Userinfo is never legit, even in public values; query strings are
    // only suspicious in allowlisted server URLs (public URLs may carry
    // legitimate query params, and they are public by design anyway).
    if (/_URL$/.test(key) && !isBlankValue(rawValue.trim())) {
      if (key.startsWith('NEXT_PUBLIC_')) {
        if (hasUserinfoCredential(rawValue)) taintedPublic.push(key);
      } else if (hasEmbeddedCredential(rawValue)) {
        tainted.push(key);
      }
    }
    return;
  }
  if (!isBlankValue(rawValue.trim())) {
    offenders.push(key);
  }
});

if (
  unparseable.length > 0 ||
  offenders.length > 0 ||
  tainted.length > 0 ||
  taintedPublic.length > 0
) {
  for (const lineNumber of unparseable) {
    console.error(`Unparseable line ${lineNumber} (failing closed; content withheld).`);
  }
  for (const key of tainted) {
    console.error(
      `${key} is allowlisted as a plain endpoint but its Preview value embeds credentials. ` +
        'Move it to the redact set or re-scope the value in Vercel.',
    );
  }
  for (const key of taintedPublic) {
    console.error(
      `${key} is public by design but its Preview value embeds userinfo credentials, ` +
        'which would bake a secret into client bundles. Re-scope the value in Vercel.',
    );
  }
  for (const key of offenders) {
    console.error(
      `${key} carries a real Preview value but is not public, blank, or allowlisted. ` +
        'Mark it sensitive in Vercel or add it to the allowlist with review.',
    );
  }
  process.exit(1);
}

console.log(
  `Preview env exposure OK: no unexpected real server values in ${envFile}.`,
);
