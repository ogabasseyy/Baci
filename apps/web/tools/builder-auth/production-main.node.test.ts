import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';

test('production auth startup refuses root on Linux without disclosing details', async () => {
  const source = `Object.defineProperty(process,'platform',{value:'linux'}); Object.defineProperty(process,'getuid',{value:()=>0}); await import(${JSON.stringify(new URL('./production-main.ts', import.meta.url).href)});`;
  await assert.rejects(
    promisify(execFile)(process.execPath, [
      '--input-type=module',
      '-e',
      source,
    ]),
    (error: Error & { stderr?: string }) => {
      assert.match(error.stderr ?? '', /Baci auth broker could not start/);
      assert.doesNotMatch(error.stderr ?? '', /UNSUPPORTED_SERVICE_IDENTITY/);
      return true;
    }
  );
});
