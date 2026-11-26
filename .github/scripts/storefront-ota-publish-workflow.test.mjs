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
  assert.match(
    workflowText,
    /if \[\[ "\$prev_mode" == "rollback_to_embedded" \|\| -z "\$prev_id" \]\]; then/
  );
  assert.match(
    workflowText,
    /environment: \$\{\{ inputs\.channel == 'production' && 'Production' \|\| 'Preview' \}\}/
  );
  assert.match(
    workflowText,
    /if \[\[ "\$ALLOW_UNSIGNED" != "true" \]\]; then/
  );
  assert.match(
    workflowText,
    /safe only for runtimes without code-signed binaries/
  );
  assert.match(
    workflowText,
    /cp apps\/ota-server\/scripts\/publish-ota-args\.mjs "\$RUNNER_TEMP\/"/
  );
  assert.match(
    workflowText,
    /cp apps\/ota-server\/scripts\/publish-ota-sanitize\.mjs "\$RUNNER_TEMP\/"/
  );
  assert.match(
    workflowText,
    /rb_args\+=\(--expected-current-update-id "\$published_id"\)/
  );
  assert.match(
    workflowText,
    /Compensating rollback FAILED!/
  );
  assert.doesNotMatch(
    workflowText,
    /publish-ota\.mjs" "\$\{rb_args\[@\]\}" \|\| true/
  );
});

test('smoke-check and verify test files copied flat into RUNNER_TEMP run cleanly outside repo layout', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const copiedScripts = [
    ...workflowText.matchAll(
      /cp \.github\/scripts\/([^\s"]+\.mjs) "\$RUNNER_TEMP\/"/g
    ),
  ].map((match) => match[1]);
  assert.ok(
    copiedScripts.includes('verify-storefront-self-hosted-ota-export.test.mjs'),
    'Workflow must copy verify-storefront-self-hosted-ota-export.test.mjs to RUNNER_TEMP'
  );
  assert.ok(
    copiedScripts.includes('smoke-check-ota-manifest.test.mjs'),
    'Workflow must copy smoke-check-ota-manifest.test.mjs to RUNNER_TEMP'
  );

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ota-runner-temp-'));
  try {
    for (const file of copiedScripts) {
      copyFileSync(path.join(SCRIPTS_DIR, file), path.join(tempDir, file));
    }
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const output = execFileSync(
      process.execPath,
      [
        '--test',
        '--test-reporter=spec',
        path.join(tempDir, 'smoke-check-ota-manifest.test.mjs'),
        path.join(tempDir, 'verify-storefront-self-hosted-ota-export.test.mjs'),
      ],
      { cwd: tempDir, env: childEnv, encoding: 'utf8' }
    );
    assert.match(output, /(?:ℹ|#)\s+fail\s+0\b/);
    const passMatch = /(?:ℹ|#)\s+pass\s+(\d+)\b/.exec(output);
    assert.ok(
      passMatch && Number(passMatch[1]) >= 4,
      `Expected >= 4 passing tests in RUNNER_TEMP, got:\n${output}`
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
