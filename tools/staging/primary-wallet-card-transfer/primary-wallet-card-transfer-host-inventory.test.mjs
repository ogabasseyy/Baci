import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { collectPrimaryTransferHostInventory } from './primary-wallet-card-transfer-host-inventory.mjs';

test('collects only fixed-host metadata without environment reads, readiness claims or remote writes', () => {
  let observed;
  const report = collectPrimaryTransferHostInventory({ instance: 'primary', run: (command, args, options) => {
    observed = { command, args, options };
    return { status: 0, stdout: JSON.stringify({ nodeMajor: 24, accountPresent: false, paths: {}, units: {} }) };
  }, now: () => new Date('2026-10-07T21:00:00Z') });
  assert.equal(report.activationAuthorized, false);
  assert.equal(report.databaseInspected, false);
  assert.equal(report.configurationValuesInspected, false);
  assert.equal(report.instance, 'primary');
  assert.equal(observed.args[4], 'bassey@82.29.190.219');
  assert.match(observed.options.input, /file!='\/etc\/baci\/primary-card-transfer-primary.env'/);
  assert.match(observed.options.input, /baci-primary-card-transfer@primary.timer/);
  assert.doesNotMatch(observed.options.input, /writeFile|--once|restart|enable|sudo/);
  const readPaths = [];
  vm.runInNewContext(observed.options.input, {
    require: (name) => name==='node:crypto' ? crypto : name==='node:child_process' ? { spawnSync: () => ({ status:0, stdout:'' }) } : {
      lstatSync: () => ({ isFile: () => true, uid:0, gid:0, mode:0o100644, size:10 }),
      readFileSync: (filename) => { readPaths.push(filename); return Buffer.from('synthetic-artifact'); },
    },
    process: { versions: { node:'24.21.0' }, stdout: { write: () => {} } },
  });
  assert.equal(readPaths.length, 4);
  assert.ok(readPaths.every((filename) => !filename.endsWith('.env')));
});
test('rejects unreviewed instance names before any remote contact', () => {
  for (const instance of [undefined, '', 'a/b', 'a;b', "a'b", 'a"b', 'a$b', '..', 'x'.repeat(65)])
    assert.throws(() => collectPrimaryTransferHostInventory({ instance, run: () => { throw new Error('remote contacted'); } }), /reviewed instance name/);
});
test('redacts transport errors and malformed inventory', () => {
  for (const result of [{ status: 1, stderr: 'private transport details' }, { status: 0, stdout: 'private invalid JSON' }])
    assert.throws(() => collectPrimaryTransferHostInventory({ instance: 'primary', run: () => result }), /Read-only transfer host inventory unavailable/);
});
