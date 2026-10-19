import { execFile, spawn } from 'node:child_process';
import { lstat, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  assertManagedRuntime,
  assertManagedSocket,
  readManagedFile,
  secureManagedSocket,
} from './managed-files.mjs';
import { startManagedGateway } from './managed-gateway.mjs';

const runtimeDirectory = '/run/baci-savings-gateway';
const socketPath = `${runtimeDirectory}/ingress.sock`;
const environment = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' };
const execute = promisify(execFile);

function pause(signal, milliseconds = 1000) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

export async function managedGatewayMain() {
  if (
    process.platform !== 'linux' ||
    process.geteuid() === 0 ||
    process.argv.length !== 3 ||
    process.argv[2] !== '--managed'
  )
    throw new Error('Managed Linux service required');
  process.umask(0o007);
  const uid = process.geteuid();
  const gid = process.getegid();
  const controller = new AbortController();
  const parent = process.ppid;
  let runtime;
  let owned;
  let exited;
  let socketIdentity;
  const alive = () =>
    owned && owned.exitCode === null && owned.signalCode === null;
  const terminate = () => {
    controller.abort();
    if (alive()) owned.kill('SIGTERM');
  };
  const emergency = () => {
    if (alive()) owned.kill('SIGKILL');
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.once(signal, terminate);
  process.once('exit', emergency);
  const stop = async () => {
    if (!owned) return;
    if (alive()) owned.kill('SIGTERM');
    await Promise.race([exited, pause(new AbortController().signal, 1000)]);
    if (alive()) owned.kill('SIGKILL');
    await exited;
  };
  const verifyRuntime = async () => {
    const parentInfo = await lstat('/run');
    if (
      !parentInfo.isDirectory() ||
      parentInfo.uid !== 0 ||
      parentInfo.mode & 0o022
    )
      throw new Error('Trusted runtime parent required');
    assertManagedRuntime(await lstat(runtimeDirectory), uid, gid);
    if (process.ppid !== parent) throw new Error('Managed parent exited');
    if (socketIdentity) {
      const info = await lstat(socketPath);
      assertManagedSocket(info, uid, gid);
      if (`${info.dev}:${info.ino}` !== socketIdentity)
        throw new Error('Socket replaced');
    }
  };
  try {
    await verifyRuntime();
    try {
      await lstat(socketPath);
      throw new Error('Existing socket refused');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const bindingFile = await readManagedFile(
      '/etc/baci-savings-gateway/binding.json'
    );
    const evidenceFile = await readManagedFile(
      '/etc/baci-savings-gateway/startup-evidence.json'
    );
    if (
      Object.keys(evidenceFile.value).sort().join(',') !== 'inventory,receipt'
    )
      throw new Error('Startup evidence rejected');
    await startManagedGateway(
      bindingFile.value,
      evidenceFile.value,
      {
        now: Date.now,
        monotonicNow: () => performance.now(),
        binding: async () => {
          await verifyRuntime();
          const current = await readManagedFile(
            '/etc/baci-savings-gateway/binding.json'
          );
          if (current.fingerprint !== bindingFile.fingerprint)
            throw new Error('Binding replaced');
          return current.value;
        },
        inventory: async () =>
          JSON.parse(
            (
              await execute(
                '/usr/bin/sudo',
                [
                  '-n',
                  '--',
                  '/opt/baci-savings-gateway/managed-inventory-helper.mjs',
                ],
                {
                  env: environment,
                  timeout: 2500,
                  killSignal: 'SIGKILL',
                  maxBuffer: 1048576,
                  signal: controller.signal,
                }
              )
            ).stdout
          ),
        prepare: async (config, signal) => {
          runtime = await mkdtemp(join(runtimeDirectory, 'private-'));
          await writeFile(join(runtime, 'nginx.conf'), config, {
            flag: 'wx',
            mode: 0o600,
          });
          await execute(
            '/usr/bin/python3',
            [
              fileURLToPath(
                new URL(
                  './private-routing-supervisor-child.py',
                  import.meta.url
                )
              ),
              String(process.pid),
              runtime,
              '--test',
            ],
            {
              env: environment,
              timeout: 3000,
              killSignal: 'SIGKILL',
              maxBuffer: 4096,
              signal,
            }
          );
        },
        start: async (signal) => {
          if (signal.aborted) throw new Error('Cancelled');
          await verifyRuntime();
          try {
            await lstat(socketPath);
            throw new Error('Existing socket refused');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          owned = spawn(
            '/usr/bin/python3',
            [
              fileURLToPath(
                new URL(
                  './private-routing-supervisor-child.py',
                  import.meta.url
                )
              ),
              String(process.pid),
              runtime,
              '--serve',
            ],
            { env: environment, stdio: 'ignore', detached: false }
          );
          exited = new Promise((resolve) => {
            owned.once('exit', resolve);
            owned.once('error', resolve);
          });
          const deadline = performance.now() + 2000;
          while (alive() && !signal.aborted && performance.now() < deadline) {
            try {
              const info = await lstat(socketPath);
              if (!info.isSocket() || info.uid !== uid || info.gid !== gid)
                throw new Error('Managed socket creation rejected');
              socketIdentity = `${info.dev}:${info.ino}`;
              if ((info.mode & 0o7777) !== 0o770) {
                await secureManagedSocket(socketPath, info, uid, gid);
                return { alive, exited };
              }
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
            }
            await pause(signal, 50);
          }
          throw new Error('Managed listener failed');
        },
        pause,
        stop,
        cleanup: async () => {
          await stop();
          if (socketIdentity) {
            try {
              const info = await lstat(socketPath);
              if (`${info.dev}:${info.ino}` === socketIdentity)
                await unlink(socketPath);
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
            }
          }
          if (runtime) await rm(runtime, { recursive: true, force: true });
        },
      },
      controller.signal
    );
  } finally {
    await stop();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
      process.removeListener(signal, terminate);
    process.removeListener('exit', emergency);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  managedGatewayMain()
    .then(() => process.stdout.write('Managed gateway stopped.\n'))
    .catch(() => {
      process.stderr.write(
        'Managed gateway withdrawn; operator review and fresh startup evidence required.\n'
      );
      process.exitCode = 1;
    });
