// Offline per-binding stages: input snapshot integrity + acceptance match.
// The input stage returns the verified snapshot bytes (falsy = the binding
// stops, mirroring the original loop's `continue`); downstream stages reuse
// the verified buffer instead of re-reading the file.
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { acceptanceKey } from './merchant-image-pilot-preflight-records.mjs';
import {
  fail,
  pass,
  sha256Hex,
} from './merchant-image-pilot-preflight-shared.mjs';

export async function checkBindingInput({
  checks,
  failures,
  name,
  options,
  record,
}) {
  // Input snapshot integrity: the frozen input file must exist under the
  // input root and hash to the inventory claim. Without this, a tampered
  // or missing snapshot passes whenever the staged copy still matches.
  const inputRoot = resolve(options.inputRoot);
  // realpath on both sides (mirror of lab-config): lexical containment
  // passes a symlinked dir that resolves outside the root.
  const realRoot = await realpath(inputRoot).catch(() => null);
  const inputPath = resolve(inputRoot, record.sourcePath);
  const realPath = await realpath(inputPath).catch(() => null);
  if (realPath === null) {
    fail(
      checks,
      failures,
      `${name}:input`,
      `input snapshot missing: ${record.sourcePath}`
    );
    return null;
  }
  if (
    realRoot === null ||
    (realPath !== realRoot && !realPath.startsWith(`${realRoot}${sep}`))
  ) {
    fail(
      checks,
      failures,
      `${name}:input`,
      `input escapes the input root: ${record.sourcePath}`
    );
    return null;
  }
  let inputBytes;
  try {
    inputBytes = await readFile(realPath);
  } catch {
    fail(
      checks,
      failures,
      `${name}:input`,
      `input snapshot missing: ${record.sourcePath}`
    );
    return null;
  }
  if (sha256Hex(inputBytes) !== record.sha256) {
    fail(
      checks,
      failures,
      `${name}:input`,
      `input snapshot hash mismatch: ${record.sourcePath}`
    );
    return null;
  }
  pass(checks, `${name}:input`);
  return inputBytes;
}

export function checkBindingAcceptance({
  byAsset,
  checks,
  conflicting,
  effectiveRecipe,
  failures,
  name,
  record,
}) {
  const key = acceptanceKey(record);
  const acceptance = byAsset.get(key);
  if (conflicting.has(key)) {
    fail(
      checks,
      failures,
      `${name}:acceptance`,
      'conflicting duplicate acceptances'
    );
    return null;
  }
  if (!acceptance) {
    fail(
      checks,
      failures,
      `${name}:acceptance`,
      'no acceptance record for this merchant/asset'
    );
    return null;
  }
  if (acceptance.verdict !== 'accepted') {
    fail(
      checks,
      failures,
      `${name}:acceptance`,
      `verdict is "${acceptance.verdict}"`
    );
    return null;
  }
  if (acceptance.recipeId !== effectiveRecipe) {
    fail(
      checks,
      failures,
      `${name}:acceptance`,
      `recipe "${acceptance.recipeId}" is not current ("${effectiveRecipe}")`
    );
    return null;
  }
  if (acceptance.sourceSha256 !== record.sha256) {
    fail(
      checks,
      failures,
      `${name}:acceptance`,
      'acceptance source hash differs from inventory'
    );
    return null;
  }
  pass(checks, `${name}:acceptance`);
  return acceptance;
}
