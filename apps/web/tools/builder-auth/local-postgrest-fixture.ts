/** Local-only PostgREST process using an owned Unix socket; no production connection. */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
export async function startLocalPostgrest(options: {
  databaseSocket: string;
  role: string;
  jwks: unknown;
  binary?: string;
}) {
  if (
    !path.isAbsolute(options.databaseSocket) ||
    !/^builder_[a-z_]+_fixture$/.test(options.role)
  )
    throw Error('Invalid local Data API binding');
  const binary = options.binary ?? '/opt/homebrew/bin/postgrest';
  if (!path.isAbsolute(binary))
    throw Error('PostgREST binary must be absolute');
  const version = execFileSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (version !== 'PostgREST 16.4')
    throw Error('Expected explicitly qualified local PostgREST16.4');
  const root = mkdtempSync(path.join(tmpdir(), 'baci-builder-rest-'));
  const socketPath = path.join(root, 'api.sock');
  const child = spawn(binary, [], {
    env: {
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      PATH: process.env.PATH,
      PGRST_DB_URI: `postgresql://${options.role}@/postgres?host=${encodeURIComponent(options.databaseSocket)}`,
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_DB_SCHEMAS: 'public',
      PGRST_JWT_AUD: 'authenticated',
      PGRST_JWT_SECRET: JSON.stringify(options.jwks),
      PGRST_SERVER_UNIX_SOCKET: socketPath,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: '0',
      PGRST_LOG_LEVEL: 'crit',
    },
    stdio: 'ignore',
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.once('error', () => {
    exited = true;
  });
  const close = async () => {
    if (!exited) {
      const done = new Promise<void>((resolve) =>
        child.once('exit', () => resolve())
      );
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await done;
      clearTimeout(timer);
    }
    rmSync(root, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (exited) throw Error('Local Data API process failed');
      ready = await new Promise<boolean>((resolve) => {
        const req = request({ socketPath, path: '/', method: 'GET' }, (res) => {
          res.resume();
          resolve((res.statusCode ?? 500) < 500);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(250, () => {
          req.destroy();
          resolve(false);
        });
        req.end();
      });
      if (ready) break;
      await delay(50);
    }
    if (!ready) throw Error('Local Data API readiness failed');
    return { socketPath, version, close };
  } catch (error) {
    await close();
    throw error;
  }
}
