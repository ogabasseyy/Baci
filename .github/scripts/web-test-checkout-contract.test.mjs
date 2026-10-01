import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import YAML from 'yaml';

test('hydrates historical blobs before running the full web test shards', async () => {
  const workflow = YAML.parse(
    await readFile('.github/workflows/ci.yml', 'utf8')
  );
  const checkout = workflow.jobs['quality-test-web'].steps[0];

  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(checkout.with.filter, '');
  assert.equal(checkout.with['persist-credentials'], false);
});
