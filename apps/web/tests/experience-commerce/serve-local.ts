/** Explicit local-only operator; never loads hosted credentials or publishes. */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createCommerceEngineFixture } from './cart-engine-fixture.ts';
import { prepareCommerceCatalog } from './catalog-fixture.ts';
import { startCommerceDataApi } from './data-api.ts';
import { seedFixtureOutput } from './seed-output.ts';

const f = await createCommerceEngineFixture();
let api: Awaited<ReturnType<typeof startCommerceDataApi>> | undefined;
let child: ReturnType<typeof spawn> | undefined;
let gateway: { close: () => Promise<void> } | undefined;
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  if (child && !child.killed) {
    const ended = new Promise<void>((resolve) =>
      child?.once('exit', () => resolve())
    );
    child.kill('SIGTERM');
    await ended;
  }
  await gateway?.close();
  await api?.close();
  await f.close();
  process.exitCode = 0;
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
try {
  const { merchant } = await prepareCommerceCatalog(f);
  await seedFixtureOutput(f, merchant);
  api = await startCommerceDataApi(f);
  const profile = new URL(
    '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/c-runtime-profile.mjs',
    import.meta.url
  );
  await build({
    entryPoints: [
      fileURLToPath(new URL('./runtime-profile.ts', import.meta.url)),
    ],
    outfile: fileURLToPath(profile),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)),
    logLevel: 'silent',
  });
  const runtime = await import(profile.href);
  gateway = await runtime.gateway(api.url, api.anonKey);
  const app = fileURLToPath(new URL('../../', import.meta.url));
  const guard = fileURLToPath(
    new URL('./local-process-guard.mjs', import.meta.url)
  );
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: `--dns-result-order=ipv4first --import=${guard}`,
    NEXT_PUBLIC_SUPABASE_URL: api.url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: api.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: 'local-disabled-no-admin-key',
    SUPABASE_AGENTIC_JWT_PRIVATE_JWK: JSON.stringify(api.privateJwk),
    CART_SESSION_SECRET: randomBytes(48).toString('hex'),
    CART_PROOF_ENVIRONMENT: 'synthetic-checkpoint-c-local',
    NEXT_PUBLIC_ROOT_DOMAIN: 'localhost',
    PORT: '43174',
  };
  child = spawn(
    process.execPath,
    [
      createRequire(import.meta.url).resolve('next/dist/bin/next'),
      'dev',
      '--hostname',
      'localhost',
      '--port',
      '43174',
    ],
    { cwd: app, env, stdio: ['ignore', 'inherit', 'inherit'] }
  );
  child.once('exit', () => {
    child = undefined;
    void close();
  });
  console.log(
    'Synthetic local fixture ready; Next preview http://127.0.0.1:43174/qa1; no remote fetches or order writes.'
  );
  // Only public operator metadata; no tokens or connection strings.
  writeFileSync(
    new URL(
      '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/c-local-preview.json',
      import.meta.url
    ),
    JSON.stringify({
      origin: 'http://127.0.0.1:43174',
      synthetic: true,
      main: '9e0105d7ccb94c9b065c59ba9d93316c8cd5c110',
    })
  );
} catch (error) {
  await close();
  throw error;
}
