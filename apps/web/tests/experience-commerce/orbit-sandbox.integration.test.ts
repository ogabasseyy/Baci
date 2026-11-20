import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import {
  PREPARE,
  REMOVE_BUNDLE,
  ROOT,
} from '../../tools/experience-runner/local-oci-executor';
import { makeOCISpec } from '../../tools/experience-runner/oci-policy';
import { runPublicObservationJob } from '../../tools/experience-runner/public-observation-executor';
import { createPublicCartSession } from '../../tools/experience-verifier/public-cart-session';
import { createPublicCommerceRelay } from '../../tools/experience-verifier/public-commerce-relay';
import { captureOrbitSnapshot } from './orbit-snapshot.test-support';

const exec = promisify(execFile);

it.skipIf(process.env.BACI_LOCAL_ORBIT_SANDBOX_TEST !== '1')(
  'runs generated Orbit and synthetic Baci checkout review in network-disabled gVisor',
  async () => {
    const fixturePath = process.env.BACI_LOCAL_FIXTURE_INFO;
    if (
      !fixturePath ||
      !/^\/Users\/mac\/\.codex\/tmp\/baci-synthetic-[0-9a-f-]+\.json$/.test(
        fixturePath
      )
    )
      throw Error('INVALID_SYNTHETIC_FIXTURE_INFO_PATH');
    const info: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
    if (
      !info ||
      typeof info !== 'object' ||
      !('url' in info) ||
      !('anonKey' in info) ||
      typeof info.url !== 'string' ||
      typeof info.anonKey !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(info.url)
    )
      throw Error('INVALID_SYNTHETIC_FIXTURE_INFO');
    const fixtureUrl = info.url;
    const fixtureAnonKey = info.anonKey;
    const directory = mkdtempSync(
      '/Users/mac/.codex/tmp/baci-browser-channel-'
    );
    const worker = join(directory, 'worker.mjs');
    const snapshotPath = join(directory, 'snapshot.json');
    let prepared = false;
    try {
      const snapshot = await captureOrbitSnapshot(fixtureUrl);
      writeFileSync(snapshotPath, JSON.stringify(snapshot), { mode: 0o644 });
      await build({
        entryPoints: ['tests/experience-commerce/orbit-sandbox-worker.ts'],
        outfile: worker,
        bundle: true,
        platform: 'node',
        format: 'esm',
        external: ['playwright-core'],
        logLevel: 'silent',
      });
      const spec = makeOCISpec(
        `${ROOT}/browser/rootfs`,
        ['/usr/local/bin/node', '/opt/experience/public-browser-worker.mjs'],
        'capture'
      );
      spec.process.env.push(
        'HOME=/tmp',
        'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'
      );
      spec.mounts.push({
        destination: '/opt/experience/public-browser-worker.mjs',
        type: 'bind',
        source: worker,
        options: ['bind', 'ro', 'nosuid', 'nodev'],
      });
      spec.mounts.push({
        destination: '/opt/experience/checkpoint-b-host.js',
        type: 'bind',
        source: snapshotPath,
        options: ['bind', 'ro', 'nosuid', 'nodev'],
      });
      let stderr = '';
      const paths: string[] = [];
      const session = createPublicCartSession({
        origin: 'https://qa1.example.test',
        merchantSlug: 'qa1',
        merchantId: '11111111-1111-4111-8111-111111111111',
        productId: '33333333-3333-4333-8333-333333333333',
        network: async (request) => {
          const path = new URL(request.url).pathname;
          paths.push(path);
          const headers: Record<string, string> = {
            ...request.headers,
            host: 'qa1.localhost:43174',
          };
          if (headers.origin) headers.origin = 'http://qa1.localhost:43174';
          const response = await fetch(`http://qa1.localhost:43174${path}`, {
            method: request.method,
            headers,
            body: request.body,
            redirect: 'manual',
          });
          return {
            status: response.status,
            body: Buffer.from(await response.arrayBuffer()),
            cookies: response.headers
              .getSetCookie()
              .map((cookie) => `${cookie}; Secure`),
          };
        },
      });
      const relay = createPublicCommerceRelay({
        product: {
          origin: 'https://project.supabase.co',
          merchantId: '11111111-1111-4111-8111-111111111111',
          productId: '33333333-3333-4333-8333-333333333333',
        },
        cart: session,
        readProduct: async (request) => {
          paths.push('/rest/v1/products');
          const search = new URL(request.url).search;
          const response = await fetch(
            `${fixtureUrl}/rest/v1/products${search}`,
            {
              headers: {
                apikey: fixtureAnonKey,
                authorization: `Bearer ${fixtureAnonKey}`,
              },
              redirect: 'error',
            }
          );
          if (!response.ok) throw Error('SYNTHETIC_PRODUCT_READ_FAILED');
          return { status: response.status, body: await response.text() };
        },
      });
      const command = async (_program: string, args: string[]) => {
        if (args[2] === 'prepare' && args[3] === 'public-observe') {
          const name = args[4];
          const preparation = exec(
            'colima',
            ['ssh', '--', 'sudo', 'python3', '-c', PREPARE],
            { timeout: 15000 }
          );
          preparation.child.stdin?.end(JSON.stringify({ name, spec }));
          await preparation;
          prepared = true;
          return '';
        }
        if (args[2] === 'delete') {
          const name = args[3];
          await exec(
            'colima',
            [
              'ssh',
              '--',
              'sudo',
              '/usr/local/bin/runsc',
              `--root=${ROOT}/state`,
              'delete',
              '--force',
              name,
            ],
            { timeout: 15000 }
          );
          await exec(
            'colima',
            ['ssh', '--', 'sudo', 'python3', '-c', REMOVE_BUNDLE, name],
            { timeout: 15000 }
          );
          prepared = false;
          return '';
        }
        throw Error('INVALID_TEST_HELPER_COMMAND');
      };
      const start = (name: string) => {
        const child = spawn(
          'colima',
          [
            'ssh',
            '--',
            'sudo',
            '/usr/local/bin/runsc',
            `--root=${ROOT}/state`,
            '--network=none',
            'run',
            `--bundle=${ROOT}/jobs/${name}`,
            name,
          ],
          { stdio: 'pipe' }
        );
        child.stderr.on('data', (chunk) => {
          stderr = (stderr + chunk.toString()).slice(-4096);
        });
        return child;
      };
      let observation: unknown;
      try {
        observation = (
          await runPublicObservationJob(
            { payload: { synthetic: true }, session: relay },
            { command, start }
          )
        ).output;
      } catch {
        throw Error(`Synthetic runner channel failed: ${stderr}`);
      }
      expect(observation).toEqual({
        status: 'passed',
        orbit: true,
        checkoutReviewed: true,
        checkoutPresented: true,
        commerceObserved: true,
        orderBlocked: true,
      });
      expect(paths).toContain('/rest/v1/products');
      expect(paths).toContain('/api/storefront/cart/commands');
      expect(paths).toContain('/api/storefront/cart/checkout');
      expect(paths).not.toContain('/api/orders');
    } finally {
      if (!prepared) rmSync(directory, { recursive: true, force: true });
    }
  },
  240000
);
