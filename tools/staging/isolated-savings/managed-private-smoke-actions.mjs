import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, unlink } from 'node:fs/promises';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';

const unit = 'baci-savings-gateway.service';
const account = 'baci-savings-gateway';
const code = '/opt/baci-savings-gateway';
const config = '/etc/baci-savings-gateway';
const runtime = '/run/baci-savings-gateway';
const socketPath = `${runtime}/ingress.sock`;
const env = {
  PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
  HOME: '/',
};
const execute = promisify(execFile);
const requireValue = (value) => {
  if (!value) throw new Error('Rejected');
};
const fingerprint = (info) =>
  ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'uid', 'gid', 'mode', 'nlink']
    .map((key) => info[key])
    .join(':');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_PRIVATE_SMOKE_LEASE_MS = 7 * 24 * 60 * 60 * 1000;

export function nativeActions() {
  const run = async (command, args) =>
    (
      await execute(command, args, {
        env,
        timeout: 8000,
        killSignal: 'SIGKILL',
        maxBuffer: 1048576,
      })
    ).stdout.trim();
  const absent = async (path) => {
    try {
      await lstat(path);
      return false;
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
  };
  const state = async () =>
    Object.fromEntries(
      (
        await run('/usr/bin/systemctl', [
          'show',
          unit,
          '--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Restart,NRestarts,FragmentPath,DropInPaths,UnitFileState,NeedDaemonReload',
        ])
      )
        .split('\n')
        .map((line) => line.split('='))
    );
  const get = (options) =>
    new Promise((resolve, reject) => {
      const call = request(
        {
          ...options,
          method: 'GET',
          headers: { Host: 'staging-auth.ogabassey.com' },
        },
        (response) => {
          response.destroy();
          resolve(response.statusCode);
        }
      );
      const timer = setTimeout(() => call.destroy(new Error('Deadline')), 2500);
      call.on('close', () => clearTimeout(timer));
      call.on('error', reject);
      call.end();
    });
  return {
    now: Date.now,
    monotonic: () => performance.now(),
    pause,
    run,
    absent,
    state,
    get,
    modules: async () => ({
      ...(await import(`${code}/managed-gateway.mjs`)),
      ...(await import(`${code}/private-routing-inventory.mjs`)),
      ...(await import(`${code}/managed-inventory-helper.mjs`)),
    }),
    noProcesses: async (uid) => {
      for (const name of await readdir('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        try {
          requireValue((await lstat(`/proc/${name}`)).uid !== uid);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    },
    create: async (name, value, gid, owned) => {
      const path = `${config}/${name}.json`;
      const file = await open(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW,
        0o600
      );
      const record = {
        path,
        fingerprint: fingerprint(await file.stat()),
        hash: sha(''),
      };
      owned.push(record);
      try {
        await file.writeFile(JSON.stringify(value));
        await file.chown(0, gid);
        await file.chmod(0o440);
        await file.sync();
      } finally {
        record.fingerprint = fingerprint(await file.stat());
        const bytes = Buffer.alloc((await file.stat()).size);
        await file.read(bytes, 0, bytes.length, 0);
        record.hash = sha(bytes);
        await file.close();
      }
    },
    remove: async (record) => {
      requireValue(
        fingerprint(await lstat(record.path)) === record.fingerprint
      );
      requireValue(sha(await readFile(record.path)) === record.hash);
      requireValue(
        fingerprint(await lstat(record.path)) === record.fingerprint
      );
      await unlink(record.path);
    },
    socket: async (uid, gid) => {
      const parent = await lstat(runtime);
      const socket = await lstat(socketPath);
      requireValue(
        parent.isDirectory() &&
          parent.uid === uid &&
          parent.gid === gid &&
          (parent.mode & 0o7777) === 0o750
      );
      requireValue(
        socket.isSocket() &&
          socket.uid === uid &&
          socket.gid === gid &&
          (socket.mode & 0o7777) === 0o660
      );
    },
    noNewPrivs: async (pid) => {
      requireValue(/^[1-9]\d*$/.test(pid));
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      const value = /^NoNewPrivs:\s+([01])$/m.exec(status)?.[1];
      requireValue(value !== undefined);
      return Number(value);
    },
    report: (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
  };
}

export const stopped = (value) =>
  ['inactive', 'failed'].includes(value.ActiveState) && value.MainPID === '0';

export { requireValue, fingerprint, sha, execute, pause, unit, account, code, config, runtime, socketPath, env, MAX_PRIVATE_SMOKE_LEASE_MS };

