import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { startCommerceDataApi } from '../experience-commerce/data-api';

/** Start only an owned loopback Next process, backed by the disposable Data API. */
export async function startCombinedStorefrontServer(
  api: Awaited<ReturnType<typeof startCommerceDataApi>>,
  directory: string
) {
  if (
    !directory.startsWith('/var/folders/') ||
    !api.url.startsWith('http://127.0.0.1:')
  )
    throw Error('LOCAL_FIXTURE_REQUIRED');
  const runtime = join(directory, 'runtime.mjs');
  await build({
    entryPoints: [
      'tests/experience-authoring/combined-public-runtime.test-support.ts',
    ],
    outfile: runtime,
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: 'tsconfig.json',
    logLevel: 'silent',
  });
  const reservation = createServer();
  await new Promise<void>((resolve, reject) =>
    reservation.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw Error('LOCAL_PORT_UNAVAILABLE');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve()))
  );
  const guard = fileURLToPath(
    new URL('./combined-local-guard.mjs', import.meta.url)
  );
  const child = spawn(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('next/dist/bin/next'),
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: 'C.UTF-8',
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        NODE_OPTIONS: `--dns-result-order=ipv4first --import=${guard}`,
        BACI_SYNTHETIC_RUNTIME_PATH: runtime,
        NEXT_PUBLIC_SUPABASE_URL: api.url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: api.anonKey,
        SUPABASE_SERVICE_ROLE_KEY: 'local-disabled-no-admin-key',
        SUPABASE_AGENTIC_JWT_PRIVATE_JWK: JSON.stringify(api.privateJwk),
        CART_SESSION_SECRET: randomBytes(48).toString('hex'),
        CART_PROOF_ENVIRONMENT: 'synthetic-combined-local',
        NEXT_PUBLIC_ROOT_DOMAIN: 'synthetic.test',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-12000);
    });
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = new Promise<void>((resolve) =>
      child.once('exit', () => resolve())
    );
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await ended;
    clearTimeout(timer);
  };
  try {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error(`LOCAL_STOREFRONT_EXITED: ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(3000),
          redirect: 'manual',
        });
        if (response.status < 500) {
          // Next dev compiles route handlers on first use. Warm read-only GETs
          // so the application's five-second verification deadline measures
          // the handler rather than development compilation on this host.
          for (const path of [
            '/api/csrf',
            '/api/storefront/experience/state',
            '/api/storefront/experience/launch',
            '/api/storefront/experience/catalog',
            '/api/storefront/cart',
            '/api/shipping/quotes',
            '/synthetic/checkout',
          ]) {
            await fetch(`http://127.0.0.1:${port}${path}`, {
              signal: AbortSignal.timeout(90000),
              redirect: 'manual',
            });
          }
          return {
            origin: `http://127.0.0.1:${port}`,
            close,
            output: () => output,
          };
        }
      } catch {
        /* Startup is still in progress. */
      }
      await delay(500);
    }
    throw Error(`LOCAL_STOREFRONT_TIMEOUT: ${output}`);
  } catch (error) {
    await close();
    throw error;
  }
}
