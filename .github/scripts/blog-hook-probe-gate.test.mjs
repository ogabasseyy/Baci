import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const DEPLOY = join(scriptDir, '..', 'workflows', 'deploy.yml');

describe('db-migrations blog probe gate', () => {
  it('applies through the scope hook, probes, then grants', () => {
    const yaml = readFileSync(DEPLOY, 'utf8');
    const capped = yaml.indexOf('MIGRATION_MAX_VERSION: 20261009230000');
    const probe = yaml.indexOf('run: .github/scripts/probe-blog-media-hook-reload.sh');
    const remaining = yaml.indexOf('Apply remaining pending migrations via Management API');
    assert.ok(capped !== -1, 'scope-capped apply step is present');
    assert.ok(probe !== -1, 'blog probe step is present');
    assert.ok(remaining !== -1, 'remaining apply step is present');
    assert.ok(
      capped < probe && probe < remaining,
      'blog probe gates the isolate grant: capped apply, probe, remaining apply'
    );
  });
});
