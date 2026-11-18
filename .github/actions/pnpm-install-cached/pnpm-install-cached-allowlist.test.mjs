// Colocated regression battery for .github/actions/pnpm-install-cached.
// The shared allowlist/env-hardening suite lives beside setup-pnpm-store;
// importing it here executes the full battery against THIS action's files
// too (INSTALL_ACTION assertions run in this process), so hardened paths in
// either action cannot change without adjacent regression protection.
import '../setup-pnpm-store/setup-pnpm-store-allowlist.test.mjs';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

test('shared pnpm cache saves on self-hosted runners require explicit opt-in', async () => {
  const action = await readFile(
    '.github/actions/pnpm-install-cached/action.yml',
    'utf8'
  );
  const match = action.match(
    /- name: Save pnpm store cache \(main branch only\)\s+if: >\s+([\s\S]*?)\s+uses:/
  );
  assert.ok(match, 'cache save step and condition must exist');
  const conditions = match[1].split('&&').map((part) => part.trim());
  assert.deepEqual(conditions, [
    // A persistent store (the contabo-baci-ci runners) is never archived to the GitHub cache. This
    // condition can only narrow when a save happens; the opt-in rules below are unchanged.
    "steps.pnpm-store.outputs.persistent != 'true'",
    "(runner.environment == 'github-hosted' || inputs.allow-self-hosted-cache-save == 'true')",
    "github.ref == 'refs/heads/main'",
    "github.event_name == 'push'",
    "steps.pnpm-store-cache.outputs.cache-hit != 'true'",
  ]);
});

test('only the existing deployment workflow explicitly opts in to self-hosted cache saves', async () => {
  const action = await readFile(
    '.github/actions/pnpm-install-cached/action.yml',
    'utf8'
  );
  const deploy = await readFile('.github/workflows/deploy.yml', 'utf8');
  assert.match(
    action,
    /allow-self-hosted-cache-save:\s*\n(?:[^\n]*\n)*?\s*default: 'false'/
  );
  const parts = deploy.split(/^  deploy-production:\s*$/m);
  assert.equal(parts.length, 2, 'deploy-production must appear exactly once');
  const productionJob = parts[1].split(/^  [a-zA-Z0-9_-]+:\s*$/m)[0];
  assert.match(
    productionJob,
    /uses: \.\/\.github\/actions\/pnpm-install-cached\s+with:\s+allow-self-hosted-cache-save: 'true'/
  );
  assert.doesNotMatch(
    deploy.replace(productionJob, ''),
    /allow-self-hosted-cache-save\s*:\s*['"]?true/i
  );
  const workflows = await readdir('.github/workflows');
  for (const name of workflows.filter(
    (file) => /\.ya?ml$/.test(file) && file !== 'deploy.yml'
  )) {
    const source = await readFile(`.github/workflows/${name}`, 'utf8');
    assert.doesNotMatch(
      source,
      /allow-self-hosted-cache-save\s*:\s*['"]?true/i,
      name
    );
  }
});
