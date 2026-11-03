import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertNoPrivateValues } from './storefront-ota-secret-scan.mjs';

test('rejects a build-only secret in an exported bundle', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-validation-'));
  try {
    await writeFile(path.join(directory, 'bundle.js'), 'prefix private-build-token suffix');
    await assert.rejects(
      assertNoPrivateValues(directory, { SENTRY_AUTH_TOKEN: 'private-build-token' }),
      /SENTRY_AUTH_TOKEN/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a secret scan if an expected build-only secret is missing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-validation-'));
  try {
    await assert.rejects(
      assertNoPrivateValues(directory, { SENTRY_AUTH_TOKEN: undefined }),
      /SENTRY_AUTH_TOKEN/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a leaked trimmed secret when the build environment has whitespace', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ota-validation-'));
  try {
    await writeFile(path.join(directory, 'bundle.js'), 'private-build-token');
    await assert.rejects(
      assertNoPrivateValues(directory, { SENTRY_AUTH_TOKEN: '  private-build-token  ' }),
      /SENTRY_AUTH_TOKEN/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
