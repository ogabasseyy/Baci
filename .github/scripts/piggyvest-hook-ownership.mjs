#!/usr/bin/env node
// Ownership check for the PiggyVest transfer-engine functions.
//
// The manifest (supabase/tests/piggyvest_hook_ownership.inc.sql) names every
// engine function, its owner task and its rule. A migration declares which
// tasks it speaks for with "-- piggyvest-engine-owner: <task>" lines. This
// check fails when a migration:
//   * creates, alters or drops a manifest function it does not own, schema
//     qualified or bare (a hook owned by "none" can never change after its
//     declaration);
//   * defines a define_once function (settle_attempt, fail_attempt) a second
//     time, or alters or drops one;
//   * gives any function other than a b_writer a body that touches
//     customer_wallets, customer_wallet_transactions, transfer_b_effects or
//     apply_b_effect (B changes only through request_b_effect), including a
//     new helper function created in a hook owner's migration;
//   * builds DDL for piggyvest_primary functions dynamically;
//   * adds an on_settled_/on_failed_ hook the manifest does not list.
// It also fails when a declared (non define_once) function is never created.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROW =
  /^ {2}\('([a-z0-9_]+)', '([A-Za-z0-9-]+)', '(stub|dispatcher|b_writer|define_once)'\)[,;]$/;
const MARKER = /^-- piggyvest-engine-owner: ([A-Za-z0-9-]+)\s*$/gm;
const DECLARING_TASK = 'P5-engine-schema';
// A function reference: optional schema, then the name and its argument list.
// The argument list is optional: ALTER and DROP accept a unique bare name.
const REFERENCE = String.raw`(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s*(?:\(|(?=[\s,;]|$))`;
const DDL = /\b(create\s+(?:or\s+replace\s+)?function|alter\s+(?:function|routine))\s+/gi;
const DROP = /\bdrop\s+(?:function|routine)\s+(?:if\s+exists\s+)?/gi;
const FORBIDDEN = [
  /\bcustomer_wallets\b/i,
  /\bcustomer_wallet_transactions\b/i,
  /\btransfer_b_effects\b/i,
  /\bapply_b_effect\b/i,
];
const EXECUTE = /\bexecute\b([\s\S]*?);/gi;
const DYNAMIC_DDL = /\b(?:create|alter|drop)\b[\s\S]*\bfunction\b/i;
const PLACEHOLDER = /%[IsL]|\|\|/;

export function parseOwnershipManifest(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith("  ('")) continue;
    const match = ROW.exec(line);
    if (!match) throw new Error(`malformed ownership manifest row: ${line}`);
    const [, name, owner, rule] = match;
    if (rows.has(name)) throw new Error(`${name} is listed twice in the ownership manifest`);
    rows.set(name, { owner, rule });
  }
  if (rows.size === 0) throw new Error('ownership manifest has no rows');
  return rows;
}

// Line comments only: a marker is read before they are removed.
function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

// The dollar-quoted body, or null when the body is written another way (the
// check then fails closed instead of reading half a body).
function functionBody(sql, from) {
  const rest = sql.slice(from);
  const open = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest);
  const end = rest.indexOf(';');
  if (!open || (end !== -1 && open.index > end)) return null;
  const start = open.index + open[0].length;
  const close = rest.indexOf(open[1], start);
  return close === -1 ? null : rest.slice(start, close);
}

function statementEnd(sql, from) {
  const end = sql.indexOf(';', from);
  return end === -1 ? sql.length : end;
}

// An engine function is named with the piggyvest_primary schema, or bare
// (a search_path trick) when the bare name is a manifest function.
function engineName(schema, name, manifest) {
  if (schema) return schema.toLowerCase() === 'piggyvest_primary' ? name : null;
  return manifest.has(name) ? name : null;
}

function collectTouched(sql, manifest) {
  const touched = [];
  for (const match of sql.matchAll(DDL)) {
    const reference = new RegExp(REFERENCE, 'iy');
    reference.lastIndex = match.index + match[0].length;
    const ref = reference.exec(sql);
    if (!ref) continue;
    const name = engineName(ref[1], ref[2], manifest);
    const verb = match[1].toLowerCase().split(/\s+/)[0];
    if (name) touched.push({ verb, name, at: ref.index + ref[0].length });
  }
  for (const match of sql.matchAll(DROP)) {
    const from = match.index + match[0].length;
    const span = sql.slice(from, statementEnd(sql, from));
    for (const ref of span.matchAll(new RegExp(REFERENCE, 'gi'))) {
      const name = engineName(ref[1], ref[2], manifest);
      if (name) touched.push({ verb: 'drop', name, at: match.index });
    }
  }
  return touched.sort((a, b) => a.at - b.at);
}

function forbiddenTouch(sql, at) {
  const body = functionBody(sql, at);
  if (body === null) return 'an unparsable (not dollar-quoted) body';
  if (/\bexecute\b/i.test(body)) return 'dynamic SQL (EXECUTE)';
  const hit = FORBIDDEN.find((pattern) => pattern.test(body));
  return hit ? hit.source.replaceAll('\\b', '') : null;
}

export function checkEngineOwnership({ migrationsDir, manifestPath }) {
  const manifest = parseOwnershipManifest(readFileSync(manifestPath, 'utf8'));
  const created = new Map();
  const errors = [];
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const raw = readFileSync(join(migrationsDir, file), 'utf8');
    const owners = new Set([...raw.matchAll(MARKER)].map((match) => match[1]));
    const sql = stripComments(raw);
    for (const [, span] of sql.matchAll(EXECUTE)) {
      if (!DYNAMIC_DDL.test(span)) continue;
      const named = [...manifest.keys()].some((name) => new RegExp(`\\b${name}\\b`).test(span));
      if (named || (/piggyvest_primary/i.test(span) && PLACEHOLDER.test(span))) {
        errors.push(`${file}: dynamic DDL on a piggyvest_primary function; write engine DDL literally`);
      }
    }
    // A hook owner's migration may not hide a wallet write in a helper.
    const ownerMigration = owners.size > 0 && !owners.has(DECLARING_TASK);
    for (const { verb, name, at } of collectTouched(sql, manifest)) {
      const entry = manifest.get(name);
      if (!entry) {
        if (verb === 'create' && /^on_(settled|failed)_/.test(name)) {
          errors.push(`${file}: ${name} is a hook that is not in the ownership manifest`);
        }
        const hit = verb === 'create' && ownerMigration ? forbiddenTouch(sql, at) : null;
        if (hit) {
          errors.push(`${file}: ${name} touches ${hit} in an engine owner migration; request B changes instead`);
        }
        continue;
      }
      const count = created.get(name) ?? 0;
      if (entry.rule === 'define_once') {
        if (verb !== 'create') {
          errors.push(`${file}: ${name} is define_once and cannot be altered or dropped`);
        } else if (count > 0) {
          errors.push(`${file}: ${name} is defined once; a later redefinition is refused`);
        } else if (!owners.has(entry.owner)) {
          errors.push(`${file}: ${name} may only be defined by ${entry.owner}`);
        }
      } else {
        const declaring = verb === 'create' && count === 0;
        const allowed = declaring
          ? owners.has(DECLARING_TASK)
          : entry.owner !== 'none' && owners.has(entry.owner);
        if (!allowed) {
          const owner = declaring ? DECLARING_TASK : entry.owner;
          errors.push(`${file}: ${name} may only be changed by ${owner}`);
        }
      }
      if (verb === 'create') {
        created.set(name, count + 1);
        const hit = entry.rule === 'b_writer' ? null : forbiddenTouch(sql, at);
        if (hit) errors.push(`${file}: ${name} touches ${hit}; request B changes instead`);
      }
    }
  }
  for (const [name, entry] of manifest) {
    if (entry.rule !== 'define_once' && !created.has(name)) {
      errors.push(`${name} is never declared by a migration`);
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkEngineOwnership({
    migrationsDir: 'supabase/migrations',
    manifestPath: 'supabase/tests/piggyvest_hook_ownership.inc.sql',
  });
  if (errors.length > 0) {
    for (const error of errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log('PiggyVest engine function ownership: OK');
}
