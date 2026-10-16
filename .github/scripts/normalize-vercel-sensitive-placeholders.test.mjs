import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const script = fileURLToPath(new URL('./normalize-vercel-sensitive-placeholders.mjs', import.meta.url));

test('production normalizes CLI 57 sensitive URL placeholders before validation and build', () => {
  const workflow = YAML.parse(readFileSync(new URL('../workflows/deploy.yml', import.meta.url), 'utf8'));
  const steps = workflow.jobs['deploy-production'].steps;
  const normalization = steps.findIndex(step => step.run === 'node .github/scripts/normalize-vercel-sensitive-placeholders.mjs .vercel/.env.production.local');
  assert.ok(normalization >= 0, 'CLI 57 [SENSITIVE] must not reach URL validation');
  const pull = steps.findIndex(step => step.run === '.github/scripts/run-pinned-vercel.sh pull --yes --environment=production');
  const validation = steps.findIndex(step => step.name === 'Verify GIGL fallback token presence (defined, not validity) in Vercel Production');
  const build = steps.findIndex(step => step.name === 'Build for Vercel');
  assert.ok(pull >= 0 && pull < normalization && normalization < validation && validation < build);
  assert.equal(steps[normalization].if, undefined);
  assert.equal(steps[normalization]['continue-on-error'], undefined);
});

test('normalizes only exact reserved placeholders and preserves real or malformed values and file permissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vercel-placeholder-'));
  const file = join(directory, '.env.production.local');
  const contents = 'ADDRESS_AUTOCOMPLETE_REDIS_REST_URL="[SENSITIVE]"\nADDRESS_AUTOCOMPLETE_REDIS_REST_TOKEN=\'[SENSITIVE]\'\nexport OTHER=[SENSITIVE]\r\nREAL_URL="https://redis.example.test"\nREAL_TOKEN="synthetic-token"\nMALFORMED_URL="not-a-url"\nLOOKALIKE="prefix[SENSITIVE]"\n';
  writeFileSync(file, contents, { mode: 0o600 });
  try {
    const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(file, 'utf8'), contents.replace('="[SENSITIVE]"', '=""').replace("='[SENSITIVE]'", '=""').replace('=[SENSITIVE]\r', '=""\r'));
    assert.equal(lstatSync(file).mode & 0o777, 0o600);
    assert.match(result.stdout, /^Normalized 3 sensitive build placeholders\./);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token|redis\.example|ADDRESS_AUTOCOMPLETE/);
    const again = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^Normalized 0 /);
    const link = join(directory, 'linked.env');
    symlinkSync(file, link);
    assert.notEqual(spawnSync(process.execPath, [script, link], { encoding: 'utf8' }).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('normalizer-only edits select deployment and its required regression suite', () => {
  const ci = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  const deploy = YAML.parse(readFileSync(new URL('../filters/deploy.yml', import.meta.url), 'utf8'));
  for (const path of ['.github/scripts/normalize-vercel-sensitive-placeholders.mjs', '.github/scripts/normalize-vercel-sensitive-placeholders.test.mjs']) {
    assert.ok(ci.deploy_scripts.includes(path), path);
    assert.ok(deploy.web.includes(path), path);
  }
});


test('required deployment regression suite lists the normalizer directly without a transitive test import', () => {
  const workflow = YAML.parse(readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8'));
  const commands = Object.values(workflow.jobs).flatMap(job => job.steps ?? []).map(step => step.run ?? '').join('\n');
  const entry = '.github/scripts/normalize-vercel-sensitive-placeholders.test.mjs';
  assert.equal(commands.split(entry).length - 1, 1);
  const previousEntry = readFileSync(new URL('./assert-vercel-pulled-sensitive-env.test.mjs', import.meta.url), 'utf8');
  assert.ok(!previousEntry.includes("import './normalize-vercel-sensitive-placeholders.test.mjs'"));
});
