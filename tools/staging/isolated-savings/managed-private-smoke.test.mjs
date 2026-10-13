import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifySmokeInputs } from './managed-private-smoke.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root = new URL('./', import.meta.url);
  const manifestBytes = await readFile(new URL('managed-install-manifest.json', root));
  const manifest = JSON.parse(manifestBytes);
  const records = new Map();
  const add = (path, bytes, mode = 0o400, gid = 0) => records.set(path, { bytes: Buffer.from(bytes), mode, gid });
  add('/sealed/entry.mjs', 'entry'); add('/sealed/runner.mjs', 'runner');
  add('/sealed/identity.json', '{}'); add('/sealed/manifest.json', manifestBytes);
  add('/var/lib/baci-savings-gateway-install/receipt.json', JSON.stringify({ version: 1,
    manifestSha256: hash(manifestBytes), entries: [{ kind: 'user', uid: 100, gid: 101 }, { kind: 'group', gid: 101 }] }), 0o600);
  const runtime = Object.keys(manifest.files).filter((name) => name.endsWith('.mjs') || name === 'private-routing-supervisor-child.py');
  for (const name of runtime) add(`/opt/baci-savings-gateway/${name}`, await readFile(new URL(name, root)), name === 'managed-inventory-helper.mjs' ? 0o550 : 0o440, 101);
  for (const [path, name, mode] of [
    ['/opt/baci-savings-gateway/baci-savings-gateway.service', 'managed-gateway.service', 0o400],
    ['/opt/baci-savings-gateway/managed-gateway.sudoers', 'managed-gateway.sudoers', 0o400],
    ['/etc/systemd/system/baci-savings-gateway.service', 'managed-gateway.service', 0o444],
    ['/etc/sudoers.d/baci-savings-gateway', 'managed-gateway.sudoers', 0o440],
  ]) add(path, await readFile(new URL(name, root)), mode);
  const io = {
    lstat: async (path) => ({ isDirectory: () => true, uid: 0,
      mode: ['/opt/baci-savings-gateway', '/etc/baci-savings-gateway'].includes(path) ? 0o750 : 0o755,
      gid: 101 }),
    open: async (path) => {
      const record = records.get(path);
      assert.ok(record, path);
      return { stat: async () => ({ isFile: () => true, uid: 0, nlink: 1, size: record.bytes.length, mode: record.mode, gid: record.gid }),
        readFile: async () => record.bytes, close: async () => {} };
    },
    readdir: async (path) => path === '/etc/baci-savings-gateway' ? [] : [...runtime, 'baci-savings-gateway.service', 'managed-gateway.sudoers'],
  };
  const options = { self: '/sealed/entry.mjs', runner: '/sealed/runner.mjs', identityPath: '/sealed/identity.json', manifestPath: '/sealed/manifest.json',
    selfHash: hash('entry'), runnerHash: hash('runner'), identityHash: hash('{}'), manifestHash: hash(manifestBytes) };
  return { io, options, records };
}

test('verifies full installed runtime and unit/sudoers against reviewed manifest before return', async () => {
  const { io, options } = await fixture();
  assert.deepEqual(await verifySmokeInputs(options, io), { identity: {}, uid: 100, gid: 101 });
});
for (const path of ['/sealed/entry.mjs', '/sealed/runner.mjs', '/sealed/identity.json',
  '/sealed/manifest.json', '/opt/baci-savings-gateway/compose.mjs',
  '/etc/systemd/system/baci-savings-gateway.service', '/etc/sudoers.d/baci-savings-gateway']) {
  test(`rejects changed bytes: ${path}`, async () => {
    const { io, options, records } = await fixture();
    records.get(path).bytes = Buffer.from('changed');
    await assert.rejects(verifySmokeInputs(options, io));
  });
}
test('rejects writable runtime source and existing config', async () => {
  const { io, options, records } = await fixture();
  records.get('/opt/baci-savings-gateway/compose.mjs').mode = 0o640;
  await assert.rejects(verifySmokeInputs(options, io));
  records.get('/opt/baci-savings-gateway/compose.mjs').mode = 0o440;
  const original = io.readdir;
  io.readdir = async (path) => path.startsWith('/etc') ? ['binding.json'] : original(path);
  await assert.rejects(verifySmokeInputs(options, io));
});
