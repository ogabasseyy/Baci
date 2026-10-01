import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import { makeFakeCommand } from './deploy-with-retry.test-helpers.mjs';
import { runScript } from './deploy-with-retry.run-script.mjs';

test('checks the current-main guard before deploy and before promotion', () => {
  const fakeCommand = makeFakeCommand('success');
  const guardPath = `${fakeCommand.tempDir}/current-main-guard`;
  const guardCallsPath = `${fakeCommand.tempDir}/guard-calls`;
  writeFileSync(
    guardPath,
    `#!/usr/bin/env bash
set -euo pipefail
calls=0
if [ -f "${guardCallsPath}" ]; then calls="$(cat "${guardCallsPath}")"; fi
printf '%s\n' "$((calls + 1))" >"${guardCallsPath}"
`,
    { mode: 0o755 }
  );

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_CURRENT_MAIN_GUARD: guardPath,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(guardCallsPath, 'utf8').trim(), '2');
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('refuses to deploy when the current-main guard rejects the SHA', () => {
  const fakeCommand = makeFakeCommand('success');
  const guardPath = `${fakeCommand.tempDir}/current-main-guard`;
  writeFileSync(guardPath, '#!/usr/bin/env bash\nexit 78\n', { mode: 0o755 });

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_CURRENT_MAIN_GUARD: guardPath,
    });

    assert.equal(result.status, 78);
    assert.match(result.stderr, /current-main deployment guard refused/);
    assert.throws(() => readFileSync(fakeCommand.attemptsFile, 'utf8'));
    assert.throws(() => readFileSync(fakeCommand.promotedFile, 'utf8'));
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});

test('never promotes when main advances after the staged deployment', () => {
  const fakeCommand = makeFakeCommand('success');
  const guardPath = `${fakeCommand.tempDir}/current-main-guard`;
  const guardCallsPath = `${fakeCommand.tempDir}/guard-calls`;
  writeFileSync(
    guardPath,
    `#!/usr/bin/env bash
set -euo pipefail
calls=0
if [ -f "${guardCallsPath}" ]; then calls="$(cat "${guardCallsPath}")"; fi
calls=$((calls + 1))
printf '%s\n' "$calls" >"${guardCallsPath}"
[ "$calls" -eq 1 ]
`,
    { mode: 0o755 }
  );

  try {
    const result = runScript(fakeCommand, ['fake-vercel', 'deploy'], {
      DEPLOY_CURRENT_MAIN_GUARD: guardPath,
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /current-main deployment guard refused to promote/
    );
    assert.equal(readFileSync(fakeCommand.attemptsFile, 'utf8').trim(), '1');
    assert.throws(() => readFileSync(fakeCommand.promotedFile, 'utf8'));
  } finally {
    rmSync(fakeCommand.tempDir, { recursive: true, force: true });
  }
});
