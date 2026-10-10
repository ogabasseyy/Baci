import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { supervisePrivateRouting } from './private-routing-supervisor.mjs';
import { collectSupervisorInventory } from './private-routing-supervisor-inventory.mjs';

const execute = promisify(execFile);
const environment = { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' };
const controller = new AbortController();
const parent = process.ppid;
let runtime;
let owned;

function alive() {
  return owned && owned.exitCode === null && owned.signalCode === null;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.once(signal, () => {
    controller.abort();
    if (alive()) owned.kill('SIGTERM');
  });
process.once('exit', () => {
  if (alive()) owned.kill('SIGKILL');
});

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

async function main() {
  if (
    process.platform !== 'linux' ||
    process.geteuid() === 0 ||
    process.argv.length !== 4 ||
    process.argv[2] !== '--foreground'
  )
    throw new Error('Unprivileged Linux foreground mode required');
  const file = await open(
    process.argv[3],
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  let input;
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.uid !== process.geteuid() ||
      info.mode & 0o077 ||
      info.size > 262144
    )
      throw new Error('Private evidence file required');
    input = JSON.parse(await file.readFile('utf8'));
    if (Object.keys(input).sort().join(',') !== 'inventory,receipt')
      throw new Error('Invalid input');
  } finally {
    await file.close();
  }
  const run = async (args) =>
    (
      await execute('docker', args, {
        env: environment,
        timeout: 1500,
        killSignal: 'SIGKILL',
        maxBuffer: 262144,
        signal: controller.signal,
      })
    ).stdout;
  await supervisePrivateRouting(
    input,
    {
      now: Date.now,
      parentAlive: () => process.ppid === parent,
      inventory: () => collectSupervisorInventory(input.receipt, run, Date.now),
      prepare: async (config, signal) => {
        runtime = await mkdtemp(join(tmpdir(), 'baci-routing-supervisor-'));
        await writeFile(join(runtime, 'nginx.conf'), config, {
          mode: 0o600,
          flag: 'wx',
        });
        await execute(
          '/usr/bin/python3',
          [
            fileURLToPath(
              new URL('./private-routing-supervisor-child.py', import.meta.url)
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
      start: (signal) => {
        if (signal.aborted) throw new Error('Cancelled');
        owned = spawn(
          '/usr/bin/python3',
          [
            fileURLToPath(
              new URL('./private-routing-supervisor-child.py', import.meta.url)
            ),
            String(process.pid),
            runtime,
            '--serve',
          ],
          {
            env: environment,
            stdio: 'ignore',
            detached: false,
          }
        );
        const exited = new Promise((resolve) => {
          owned.once('exit', resolve);
          owned.once('error', resolve);
        });
        return { alive, exited };
      },
      pause,
      stop: async (child) => {
        if (alive()) owned.kill('SIGTERM');
        await Promise.race([
          child.exited,
          pause(new AbortController().signal, 1000),
        ]);
        if (alive()) owned.kill('SIGKILL');
        await child.exited;
      },
      cleanup: async () => {
        if (runtime) await rm(runtime, { recursive: true, force: true });
      },
    },
    controller.signal
  );
}

main()
  .then(() => {
    process.stdout.write('Private routing stopped.\n');
  })
  .catch(() => {
    process.stderr.write(
      'Private routing withdrawn or refused; fresh healthy evidence and explicit restart required.\n'
    );
    process.exitCode = 1;
  });
