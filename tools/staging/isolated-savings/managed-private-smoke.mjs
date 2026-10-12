import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const code = '/opt/baci-savings-gateway';
const account = 'baci-savings-gateway';
const runtime = ['managed-gateway-cli.mjs', 'managed-gateway.mjs', 'managed-files.mjs',
  'managed-inventory-helper.mjs', 'private-routing.mjs', 'private-routing-inventory.mjs',
  'private-routing-supervisor-inventory.mjs', 'private-routing-supervisor-child.py', 'compose.mjs'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireValue = (value) => { if (!value) throw new Error('Rejected'); };

export async function verifySmokeInputs(options, io = { lstat, open, readdir }) {
  const read = async (path, mode, gid) => {
    requireValue(path === resolve(path));
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      const info = await io.lstat(parent);
      requireValue(info.isDirectory() && info.uid === 0 && !(info.mode & 0o7022));
      if (parent === '/') break;
    }
    const handle = await io.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await handle.stat();
      requireValue(before.isFile() && before.uid === 0 && before.nlink === 1 && before.size <= 1048576);
      requireValue((before.mode & 0o7777) === mode && before.gid === gid);
      const bytes = await handle.readFile();
      const after = await handle.stat();
      requireValue(['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((key) => before[key] === after[key]));
      return bytes;
    } finally { await handle.close(); }
  };
  for (const hash of [options.selfHash, options.runnerHash, options.identityHash, options.manifestHash])
    requireValue(/^[a-f0-9]{64}$/.test(hash));
  requireValue(sha(await read(options.self, 0o400, 0)) === options.selfHash);
  requireValue(sha(await read(options.runner, 0o400, 0)) === options.runnerHash);
  const identityBytes = await read(options.identityPath, 0o400, 0);
  requireValue(sha(identityBytes) === options.identityHash);
  const manifestBytes = await read(options.manifestPath, 0o400, 0);
  requireValue(sha(manifestBytes) === options.manifestHash);
  const manifest = JSON.parse(manifestBytes);
  requireValue(manifest.version === 1 && Object.keys(manifest).sort().join() === 'files,version,versions');
  const names = [...runtime, 'install-managed-gateway.py', 'managed-install-policy.py',
    'managed-install-transaction.py', 'managed-gateway.service', 'managed-gateway.sudoers'];
  requireValue(Object.keys(manifest.files).sort().join() === names.sort().join());
  const receipt = JSON.parse(await read('/var/lib/baci-savings-gateway-install/receipt.json', 0o600, 0));
  requireValue(receipt.version === 1 && receipt.manifestSha256 === options.manifestHash);
  const user = receipt.entries.filter((entry) => entry.kind === 'user');
  const group = receipt.entries.filter((entry) => entry.kind === 'group');
  requireValue(user.length === 1 && group.length === 1);
  const { uid, gid } = user[0];
  requireValue(Number.isSafeInteger(uid) && uid > 0 && Number.isSafeInteger(gid) && gid > 0 && group[0].gid === gid);
  for (const directory of [code, '/etc/baci-savings-gateway']) {
    const info = await io.lstat(directory);
    requireValue(info.isDirectory() && info.uid === 0 && info.gid === gid && (info.mode & 0o7777) === 0o750);
  }
  requireValue((await io.readdir(code)).sort().join() === [...runtime, `${account}.service`, 'managed-gateway.sudoers'].sort().join());
  requireValue((await io.readdir('/etc/baci-savings-gateway')).length === 0);
  for (const name of runtime) {
    const bytes = await read(`${code}/${name}`, name === 'managed-inventory-helper.mjs' ? 0o550 : 0o440, gid);
    requireValue(sha(bytes) === manifest.files[name]);
  }
  for (const [path, name, mode] of [
    [`${code}/${account}.service`, 'managed-gateway.service', 0o400],
    [`${code}/managed-gateway.sudoers`, 'managed-gateway.sudoers', 0o400],
    [`/etc/systemd/system/${account}.service`, 'managed-gateway.service', 0o444],
    [`/etc/sudoers.d/${account}`, 'managed-gateway.sudoers', 0o440],
  ]) requireValue(sha(await read(path, mode, 0)) === manifest.files[name]);
  return { identity: JSON.parse(identityBytes), uid, gid };
}

async function main() {
  let stage = 'bootstrap';
  try {
    requireValue(process.platform === 'linux' && process.geteuid() === 0 && process.argv.length === 8);
    requireValue(!['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'].some((key) => process.env[key]));
    const self = fileURLToPath(import.meta.url);
    const runner = fileURLToPath(new URL('./managed-private-smoke-runner.mjs', import.meta.url));
    const [selfHash, runnerHash, identityPath, identityHash, manifestPath, manifestHash] = process.argv.slice(2);
    const options = { self, runner, selfHash, runnerHash, identityPath, identityHash, manifestPath, manifestHash };
    stage = 'verify-installed';
    const input = await verifySmokeInputs(options);
    const env = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C', LC_ALL: 'C', HOME: '/' };
    requireValue(execFileSync('/usr/bin/id', ['-u', account], { env, encoding: 'utf8' }).trim() === String(input.uid));
    requireValue(execFileSync('/usr/bin/id', ['-G', account], { env, encoding: 'utf8' }).trim() === String(input.gid));
    const members = execFileSync('/usr/bin/getent', ['group', String(input.gid)], { env, encoding: 'utf8' }).trim().split(':');
    requireValue(members[0] === 'baci-savings-ingress' && members[3] === '');
    stage = 'import-verified';
    const { runPrivateSmoke } = await import(pathToFileURL(runner).href);
    await runPrivateSmoke(input);
  } catch {
    process.stderr.write(`Private smoke refused at ${stage}; no raw error output.\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
