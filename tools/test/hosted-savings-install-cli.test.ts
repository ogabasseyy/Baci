import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('CLI rejects remote DSN, resume and missing review before Docker or SQL', () => {
  for (const args of [
    ['--dsn', 'postgres://remote/db'],
    ['--resume'],
    ['--install-reviewed'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        createRequire(import.meta.url).resolve('tsx'),
        fileURLToPath(
          new URL('./hosted-savings-install-cli.ts', import.meta.url)
        ),
        ...args,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Installer failed closed/);
  }
});
