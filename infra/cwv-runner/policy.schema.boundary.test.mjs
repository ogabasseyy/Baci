import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalSha256 } from './canonical-json.mjs';
import { parseRunnerPolicy } from './policy.schema.mjs';

const wirePolicy = JSON.parse(
  await readFile(new URL('./policy.json', import.meta.url), 'utf8')
);

test('decodes the compact policy wire form to the approved canonical authority', () => {
  assert.equal(
    typeof wirePolicy.repositoryAuthority.artifactDownload.allowedQueryKeys,
    'string'
  );
  assert.equal(
    typeof wirePolicy.dedicatedRuntime.deniedDestinationCidrs,
    'string'
  );
  assert.equal(
    typeof wirePolicy.processAllowSet.executables.runtimeNode,
    'string'
  );
  assert.equal(
    canonicalSha256(parseRunnerPolicy(wirePolicy)),
    'd5b894799dfafd5534b6ee10072178591c38034589b0541388d5698dfd503f21'
  );
});

test('prints decoded policy values through the JSON pointer accessor', () => {
  const modulePath = fileURLToPath(
    new URL('./policy.schema.mjs', import.meta.url)
  );
  const cases = [
    [['get', '/resources/memoryBytes'], '8589934592\n'],
    [
      ['get', '/runner/labels'],
      '["self-hosted","Linux","X64","baci-cwv-measurement"]\n',
    ],
    [['campaign-mark', 'campaign-001'], '3068019630\n'],
  ];
  for (const [args, expected] of cases) {
    assert.equal(
      execFileSync(process.execPath, [modulePath, ...args], {
        encoding: 'utf8',
      }),
      expected
    );
  }
});

test('fails closed while decoding malformed compact executable descriptors', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'cwv-policy-schema-'));
  context.after(() => rm(directory, { force: true, recursive: true }));
  await copyFile(
    fileURLToPath(new URL('./canonical-json.mjs', import.meta.url)),
    join(directory, 'canonical-json.mjs')
  );
  await copyFile(
    fileURLToPath(new URL('./policy.schema.mjs', import.meta.url)),
    join(directory, 'policy.schema.mjs')
  );
  for (const descriptor of [
    '|1,0,1,0',
    '/usr/bin/bash|1,nope,1,0',
    '/usr/bin/bash|1,0,1',
  ]) {
    const candidate = structuredClone(wirePolicy);
    candidate.processAllowSet.executables.bash = descriptor;
    await writeFile(join(directory, 'policy.json'), JSON.stringify(candidate));
    await assert.rejects(
      import(
        `${pathToFileURL(join(directory, 'policy.schema.mjs')).href}?case=${encodeURIComponent(descriptor)}`
      ),
      /invalid executable descriptor/
    );
  }
});
