import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const faults = vi.hoisted(() => ({ write: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (faults.write && typeof args[0] === 'number')
        throw Object.assign(Error('Synthetic disk write failure'), {
          code: 'ENOSPC',
        });
      return actual.writeFileSync(...args);
    },
  };
});

import { createDurablePrerenderArtifacts } from './durable-prerender-artifacts';

const roots: string[] = [];
afterEach(() => {
  faults.write = false;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-durable-'));
  roots.push(root);
  return root;
};
const binding = {
  merchantId: 'merchant',
  buildId: 'build',
  sourceDigest: 'a'.repeat(64),
  buildDigest: 'b'.repeat(64),
};
const javascript = 'export const prerender=true';
const renderer = {
  javascript,
  css: '',
  digest: createHash('sha256').update(`${javascript}\0`).digest('hex'),
  imports: ['source:app.tsx'],
};
it('survives a fresh store instance and cache pressure without storing bootstrap or authority', () => {
  const root = setup();
  const first = createDurablePrerenderArtifacts(root);
  first.retain({ ...binding, renderer });
  for (let i = 0; i < 34; i++)
    first.retain({ ...binding, buildId: `build-${i}`, renderer });
  const restarted = createDurablePrerenderArtifacts(root);
  expect(restarted.read(binding)).toEqual(renderer);
  for (const key of ['merchantId', 'buildId', 'sourceDigest', 'buildDigest'])
    expect(() => restarted.read({ ...binding, [key]: 'different' })).toThrow(
      'OUTPUT_NOT_RETAINED'
    );
  const records = readdirSync(root).filter((n) => n.endsWith('.json'));
  expect(records).toHaveLength(35);
  expect(readFileSync(join(root, records[0]), 'utf8')).not.toContain(
    'bootstrap'
  );
});
it('rejects corruption and a symlink in place of a retained record', () => {
  const root = setup();
  const store = createDurablePrerenderArtifacts(root);
  store.retain({ ...binding, renderer });
  const name = readdirSync(root).find((n) => n.endsWith('.json'));
  if (!name) throw Error('Missing fixture record');
  const file = join(root, name);
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace('prerender=true', 'prerender=false'));
  expect(() => store.read(binding)).toThrow('BUILD_FAILED');
  rmSync(file);
  symlinkSync('/etc/hosts', file);
  expect(() => store.read(binding)).toThrow('BUILD_FAILED');
});
it('enforces immutable output and a bounded durable quota without deleting older builds', () => {
  const root = setup();
  const store = createDurablePrerenderArtifacts(root, { maxEntries: 1 });
  store.retain({ ...binding, renderer });
  expect(() =>
    store.retain({ ...binding, buildId: 'other', renderer })
  ).toThrow('QUOTA_EXCEEDED');
  expect(store.read(binding)).toEqual(renderer);
});

it('recovers the exact retained artifact in an independent Node process', () => {
  const root = setup();
  createDurablePrerenderArtifacts(root).retain({ ...binding, renderer });
  const script = `import {createDurablePrerenderArtifacts} from ${JSON.stringify(new URL('./durable-prerender-artifacts.ts', import.meta.url).href)};process.stdout.write(createDurablePrerenderArtifacts(${JSON.stringify(root)}).read(${JSON.stringify(binding)}).digest);`;
  const actual = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: 'C.UTF-8',
        NODE_ENV: 'test',
      },
      timeout: 15000,
    }
  );
  expect(actual).toBe(renderer.digest);
});

it('removes incomplete private temporary data when the disk write fails', () => {
  const root = setup();
  const store = createDurablePrerenderArtifacts(root);
  faults.write = true;
  expect(() => store.retain({ ...binding, renderer })).toThrow(
    'Synthetic disk write failure'
  );
  expect(readdirSync(root).filter((name) => name.startsWith('.tmp-'))).toEqual(
    []
  );
});
