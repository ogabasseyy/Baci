import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { collectPrimaryCardAbandonmentHostInventory } from './primary-wallet-card-checkout-abandonment-host-inventory.mjs';

test('collects only fixed-host metadata without environment reads, readiness claims or remote writes', () => {
  let observed;
  const report = collectPrimaryCardAbandonmentHostInventory({
    run: (command, args, options) => {
      observed = { command, args, options };
      return {
        status: 0,
        stdout: JSON.stringify({
          nodeMajor: 24,
          accountPresent: false,
          paths: {},
          units: {},
        }),
      };
    },
    now: () => new Date('2026-10-09T21:00:00Z'),
  });
  assert.equal(report.activationAuthorized, false);
  assert.equal(report.databaseInspected, false);
  assert.equal(report.configurationValuesInspected, false);
  assert.equal(observed.args[4], 'bassey@82.29.190.219');
  assert.match(
    observed.options.input,
    /file!='\/etc\/baci\/primary-card-abandonment.env'/
  );
  assert.doesNotMatch(
    observed.options.input,
    /writeFile|--once|restart|enable|sudo/
  );
  const readPaths = [];
  vm.runInNewContext(observed.options.input, {
    require: (name) =>
      name === 'node:crypto'
        ? crypto
        : name === 'node:child_process'
          ? { spawnSync: () => ({ status: 0, stdout: '' }) }
          : {
              lstatSync: () => ({
                isFile: () => true,
                uid: 0,
                gid: 0,
                mode: 0o100644,
                size: 10,
              }),
              readFileSync: (filename) => {
                readPaths.push(filename);
                return Buffer.from('synthetic-artifact');
              },
            },
    process: { versions: { node: '24.21.0' }, stdout: { write: () => true } },
  });
  assert.equal(readPaths.length, 4);
  assert.ok(readPaths.every((filename) => !filename.endsWith('.env')));
});
test('redacts transport errors and malformed inventory', () => {
  for (const result of [
    { status: 1, stderr: 'private transport details' },
    { status: 0, stdout: 'private invalid JSON' },
  ])
    assert.throws(
      () => collectPrimaryCardAbandonmentHostInventory({ run: () => result }),
      /Read-only abandonment host inventory unavailable/
    );
});
