import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.resolve(
  SCRIPTS_DIR,
  '../workflows/storefront-ota-publish.yml'
);

test('publish workflow fails closed when signing is enabled without a client-embeddable cert path', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.match(workflowText, /if \[\[ -z "\$CERT_PATH" \]\]; then/);
  assert.match(
    workflowText,
    /EXPO_PUBLIC_OTA_CODE_SIGNING_CERTIFICATE_PATH is missing/
  );
  assert.match(
    workflowText,
    /if \[\[ "\$base_url" != "https:\/\/ota\.usebaci\.com" \]\]; then/
  );
});

test('smoke-check and verify test files copied flat into RUNNER_TEMP run cleanly outside repo layout', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ota-runner-temp-'));
  try {
    for (const file of [
      'storefront-ota-secret-scan.mjs',
      'verify-storefront-self-hosted-ota-export.mjs',
      'verify-storefront-self-hosted-ota-export.test.mjs',
      'smoke-check-ota-manifest.mjs',
      'smoke-check-ota-manifest.test.mjs',
    ]) {
      copyFileSync(path.join(SCRIPTS_DIR, file), path.join(tempDir, file));
    }
    execFileSync(
      process.execPath,
      [
        '--test',
        path.join(tempDir, 'smoke-check-ota-manifest.test.mjs'),
        path.join(tempDir, 'verify-storefront-self-hosted-ota-export.test.mjs'),
      ],
      { cwd: tempDir, stdio: 'pipe' }
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
