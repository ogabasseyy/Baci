import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';
import { selectPublicNginxWorkers } from './managed-nginx-worker-selection.mjs';

const target = '/etc/nginx/sites-available/staging-auth.ogabassey.com';
const state = '/var/lib/baci-savings-gateway-nginx-activation';
const candidate = `${state}/candidate.conf`;
const original = `${state}/original.conf`;
const unit = 'baci-savings-gateway.service';
const socket = '/run/baci-savings-gateway/ingress.sock';
const execute = promisify(execFile);
const environment = {
  PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
  HOME: '/',
};

function requireValue(value) {
  if (!value) throw new Error('Rejected');
}

const fingerprint = (info) =>
  [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
const ownershipFingerprint = (info) =>
  [info.dev, info.ino, info.size, info.mtimeMs].join(':');
const sha = (content) => createHash('sha256').update(content).digest('hex');

async function writeExclusive(path, content) {
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o400
  );
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function readManagedNginxSource() {
  const before = await lstat(target);
  requireValue(
    before.isFile() &&
      before.uid === 0 &&
      before.nlink === 1 &&
      !(before.mode & 0o022) &&
      before.size <= 262144
  );
  const content = await readFile(target, 'utf8');
  const after = await lstat(target);
  requireValue(
    before.dev === after.dev &&
      before.ino === after.ino &&
      before.mtimeMs === after.mtimeMs
  );
  return { content, fingerprint: fingerprint(after), sha256: sha(content) };
}

export function createManagedNginxOwnerActions({ uid, gid, source }) {
  const run = async (command, args) =>
    execute(command, args, {
      env: environment,
      timeout: 8000,
      killSignal: 'SIGKILL',
      maxBuffer: 1048576,
    });
  const candidateIsActive = async (backup) => {
    try {
      const current = await readManagedNginxSource();
      return (
        ownershipFingerprint(await lstat(target)) ===
          backup.installed?.fingerprint &&
        current.sha256 === backup.installed?.sha256
      );
    } catch {
      return false;
    }
  };
  return {
    assertGateway: async () => {
      requireValue(process.platform === 'linux' && process.geteuid() === 0);
      const fields = Object.fromEntries(
        (
          await run('/usr/bin/systemctl', [
            'show',
            unit,
            '--property=LoadState,ActiveState,Restart,NRestarts,MainPID',
          ])
        ).stdout
          .trim()
          .split('\n')
          .map((line) => line.split('='))
      );
      requireValue(
        fields.LoadState === 'loaded' &&
          fields.ActiveState === 'active' &&
          fields.Restart === 'no' &&
          fields.NRestarts === '0' &&
          /^[1-9]\d*$/.test(fields.MainPID)
      );
      const info = await lstat(socket);
      requireValue(
        info.isSocket() &&
          info.uid === uid &&
          info.gid === gid &&
          (info.mode & 0o7777) === 0o660
      );
      const nginx = Object.fromEntries(
        (
          await run('/usr/bin/systemctl', [
            'show',
            'nginx.service',
            '--property=LoadState,ActiveState,MainPID',
          ])
        ).stdout
          .trim()
          .split('\n')
          .map((line) => line.split('='))
      );
      requireValue(
        nginx.LoadState === 'loaded' &&
          nginx.ActiveState === 'active' &&
          /^[1-9]\d*$/.test(nginx.MainPID)
      );
      const workers = selectPublicNginxWorkers(
        (
          await run('/usr/bin/ps', [
            '-C',
            'nginx',
            '-o',
            'pid=,ppid=,user:32=,comm=',
          ])
        ).stdout,
        nginx.MainPID
      );
      for (const { user: worker } of workers) {
        requireValue(/^[a-z_][a-z0-9_-]{0,31}$/.test(worker));
        const groups = (await run('/usr/bin/id', ['-G', worker])).stdout
          .trim()
          .split(/\s+/)
          .map(Number);
        if (!groups.includes(gid)) {
          requireValue(worker === 'www-data' && gid === 984);
          await run('/usr/sbin/usermod', [
            '-a',
            '-G',
            'baci-savings-ingress',
            worker,
          ]);
        }
      }
      await run('/usr/bin/systemctl', ['reload', 'nginx.service']);
      const deadline = Date.now() + 5000;
      while (true) {
        const refreshed = selectPublicNginxWorkers(
          (
            await run('/usr/bin/ps', [
              '-C',
              'nginx',
              '-o',
              'pid=,ppid=,user:32=,comm=',
            ])
          ).stdout,
          nginx.MainPID
        );
        const effective = await Promise.all(
          refreshed.map(async ({ pid }) =>
            new RegExp(`^Groups:.*\\b${gid}\\b`, 'm').test(
              await readFile(`/proc/${pid}/status`, 'utf8')
            )
          )
        );
        if (effective.every(Boolean)) break;
        requireValue(Date.now() < deadline);
        await pause(100);
      }
    },
    stage: async (content) => {
      const current = await readManagedNginxSource();
      requireValue(
        current.fingerprint === source.fingerprint &&
          current.sha256 === source.sha256
      );
      await mkdir(state, { mode: 0o700 });
      await writeExclusive(original, source.content);
      await writeExclusive(candidate, content);
      return {
        original,
        candidate,
        installed: {
          fingerprint: ownershipFingerprint(await lstat(candidate)),
          sha256: sha(content),
        },
      };
    },
    activate: async (_backup) => {
      const current = await readManagedNginxSource();
      requireValue(
        current.fingerprint === source.fingerprint &&
          current.sha256 === source.sha256
      );
      await rename(candidate, target);
    },
    test: async () => {
      await run('/usr/sbin/nginx', ['-t']);
    },
    reload: async () => {
      await run('/usr/bin/systemctl', ['reload', 'nginx.service']);
    },
    isActiveCandidate: candidateIsActive,
    restore: async (backup) => {
      requireValue(await candidateIsActive(backup));
      await rename(original, target);
    },
    cleanup: async () => undefined,
  };
}
