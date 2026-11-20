import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { launchProductionAuthFromFile } from './production-entry.ts';

test('passes only a protected file to the trusted broker startup', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'baci-auth-entry-')));
  const path = join(dir, 'config.json');
  let calls = 0;
  try {
    await writeFile(path, '{"synthetic":true}', { mode: 0o600 });
    const service = await launchProductionAuthFromFile(path, async (input) => {
      calls++;
      assert.deepEqual(input, { synthetic: true });
      return { close: async () => {} };
    });
    await service.close();
    assert.equal(calls, 1);
    await writeFile(path, 'invalid');
    await assert.rejects(
      launchProductionAuthFromFile(path, async () => {
        calls++;
        return { close: async () => {} };
      }),
      /INVALID_AUTH_CONFIG_FILE/
    );
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the executable fails closed on unsupported hosts without disclosing details', async () => {
  const exec = promisify(execFile);
  const source = `Object.defineProperty(process, 'platform', {value:'darwin'}); await import(${JSON.stringify(new URL('./production-main.ts', import.meta.url).href)});`;
  await assert.rejects(
    exec(process.execPath, ['--input-type=module', '-e', source]),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? '', /Baci auth broker could not start/);
      assert.doesNotMatch(error.stderr ?? '', /UNSUPPORTED_SERVICE_IDENTITY/);
      return true;
    }
  );
});

test('the executable refuses to run as root on Linux', async () => {
  const exec = promisify(execFile);
  const source = `Object.defineProperty(process, 'platform', {value:'linux'}); Object.defineProperty(process, 'getuid', {value:()=>0}); await import(${JSON.stringify(new URL('./production-main.ts', import.meta.url).href)});`;
  await assert.rejects(
    exec(process.execPath, ['--input-type=module', '-e', source]),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? '', /Baci auth broker could not start/);
      assert.doesNotMatch(error.stderr ?? '', /UNSUPPORTED_SERVICE_IDENTITY/);
      return true;
    }
  );
});
