import assert from 'node:assert/strict';
import test from 'node:test';
import { runContractCommand } from './run.mjs';

test('CLI emits source metadata but omits detailed source entries', async () => {
  let output = '';
  const status = await runContractCommand({
    run: () =>
      Promise.resolve({
        label: 'synthetic-only',
        sourceManifest: {
          sourceCount: 48,
          sha256: 'a'.repeat(64),
          entries: ['internal-entry'],
        },
      }),
    stdout: {
      write: (text) => {
        output += text;
      },
    },
    stderr: {
      write: () => {
        throw new Error('Unexpected stderr');
      },
    },
  });
  assert.equal(status, 0);
  assert.equal(output.includes('internal-entry'), false);
  assert.equal(JSON.parse(output).sourceManifest.sourceCount, 48);
});

test('CLI returns failure without printing arbitrary diagnostic content', async () => {
  let diagnostic = '';
  const status = await runContractCommand({
    run: () =>
      Promise.reject(new Error('must-never-print-internal-diagnostic')),
    stdout: {
      write: () => {
        throw new Error('Unexpected stdout');
      },
    },
    stderr: {
      write: (text) => {
        diagnostic += text;
      },
    },
  });
  assert.equal(status, 1);
  assert.equal(diagnostic.includes('must-never-print'), false);
  assert.equal(diagnostic.includes('output withheld'), true);
});
