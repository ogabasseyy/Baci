import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { customerDraftProxyRoutes } from './customer-draft-proxy-routes';
import { prepareFundingProxyArtifact } from './prepare-funding-proxy-artifact';

let output: string;
const source = 'export default function synthetic() {}';
const metadata = '{"runtime":"nodejs24.x"}';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const pins = {
  receiverSha256: hash(source),
  functionConfigSha256: hash(metadata),
};
beforeEach(async () => {
  output = await mkdtemp(join(tmpdir(), 'funding-proxy-'));
  const directory = join(output, 'functions/api/webhooks/piggyvest.func');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.mjs'), source);
  await writeFile(join(directory, '.vc-config.json'), metadata);
  await writeFile(
    join(output, 'config.json'),
    JSON.stringify({
      version: 3,
      routes: [...customerDraftProxyRoutes(), { handle: 'filesystem' }],
    })
  );
});
afterEach(async () => {
  await rm(output, { recursive: true, force: true });
});

describe('funding prebuilt proxy artifact', () => {
  it('preserves receiver bytes and old routes while adding exact method-limited funding routes', async () => {
    await prepareFundingProxyArtifact({ output, ...pins });
    const config = JSON.parse(
      await readFile(join(output, 'config.json'), 'utf8')
    );
    expect(config.routes.slice(0, 3)).toEqual(customerDraftProxyRoutes());
    expect(config.routes.slice(3, 5)).toEqual([
      {
        src: '^/api/storefront/customer/savings/goals$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/goals',
        methods: ['GET', 'POST'],
      },
      {
        src: '^/api/storefront/customer/savings/funding$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/funding',
        methods: ['POST'],
      },
    ]);
    expect(
      config.routes.slice(5, 7).map((route: { status: number }) => route.status)
    ).toEqual([405, 405]);
    expect(config.routes.at(-1)).toEqual({ handle: 'filesystem' });
    expect(
      await readFile(
        join(output, 'functions/api/webhooks/piggyvest.func/index.mjs'),
        'utf8'
      )
    ).toBe(source);
  });
  it('refuses changed receiver code without changing routes', async () => {
    await expect(
      prepareFundingProxyArtifact({
        output,
        ...pins,
        receiverSha256: 'a'.repeat(64),
      })
    ).rejects.toThrow('preservation');
    expect(
      JSON.parse(await readFile(join(output, 'config.json'), 'utf8')).routes
    ).toHaveLength(4);
  });
  it('refuses changed function metadata', async () => {
    await expect(
      prepareFundingProxyArtifact({
        output,
        ...pins,
        functionConfigSha256: 'b'.repeat(64),
      })
    ).rejects.toThrow('preservation');
  });
  it('refuses unexpected routes or cron additions instead of silently discarding them', async () => {
    await writeFile(
      join(output, 'config.json'),
      JSON.stringify({
        version: 3,
        routes: customerDraftProxyRoutes(),
        crons: [{ path: '/api/cron/test' }],
      })
    );
    await expect(
      prepareFundingProxyArtifact({ output, ...pins })
    ).rejects.toThrow('baseline');
  });
});
