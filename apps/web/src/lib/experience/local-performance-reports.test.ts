import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createLocalPerformanceReports } from './local-performance-reports';

const directories: string[] = [];
const key = Buffer.alloc(32, 7);
const binding = {
  merchantId: 'merchant-1',
  buildId: 'build-1',
  buildDigest: 'a'.repeat(64),
  sourceDigest: 'b'.repeat(64),
};

function directory() {
  const root = mkdtempSync(join(tmpdir(), 'experience-performance-'));
  directories.push(root);
  return root;
}

function report(
  overrides: Record<string, unknown> = {},
  digests = {
    buildDigest: binding.buildDigest,
    sourceDigest: binding.sourceDigest,
  }
) {
  return {
    format: 'baci.performance-lab/v1',
    ...digests,
    measuredAt: '2026-10-26T12:00:00.000Z',
    renderer: 'prerender',
    environment: 'local-synthetic',
    cwvQualified: false,
    releaseQualified: false,
    contaminated: false,
    browser: '142.0.7444.0',
    samples: [
      {
        width: 390,
        cache: 'cold-context',
        route: '/',
        frameLcpMs: 1400,
        hostLcpMs: 1500,
        frameCls: 0.01,
        hostCls: 0.02,
        interactionDurationMs: null,
        contentVisible: true,
        imagesDecoded: true,
        consoleErrors: 0,
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  for (const root of directories.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it('retains and reads a signed report bound to the complete owner/build/source tuple', () => {
  const root = directory();
  const store = createLocalPerformanceReports(key, root);
  const value = report();

  store.retain(binding, value);

  expect(store.read(binding)).toEqual(value);
  const file = readdirSync(root).find((name) => name.endsWith('.json'));
  expect(file).toMatch(/^[a-f0-9]{64}\.json$/);
  if (!file) throw Error('Report file missing');
  expect(statSync(join(root, file)).mode & 0o777).toBe(0o600);
});

it('does not reveal a report for another merchant, build, or digest tuple', () => {
  const store = createLocalPerformanceReports(key, directory());
  store.retain(binding, report());

  expect(store.read({ ...binding, merchantId: 'merchant-2' })).toBeUndefined();
  expect(store.read({ ...binding, buildId: 'build-2' })).toBeUndefined();
  expect(
    store.read({ ...binding, sourceDigest: 'c'.repeat(64) })
  ).toBeUndefined();
});

it('fails closed when the persisted report or signature is tampered with', () => {
  const root = directory();
  const store = createLocalPerformanceReports(key, root);
  store.retain(binding, report());
  const filename = readdirSync(root).find((name) => name.endsWith('.json'));
  if (!filename) throw Error('Report file missing');
  const path = join(root, filename);
  const envelope = JSON.parse(readFileSync(path, 'utf8')) as {
    payload: string;
    signature: string;
  };
  envelope.payload = envelope.payload.replace(
    '"contaminated":false',
    '"contaminated":true'
  );
  writeFileSync(path, JSON.stringify(envelope));

  expect(() => store.read(binding)).toThrow('BUILD_FAILED');
});

it('refuses schema-invalid legacy qualification flags and binding mismatches', () => {
  const store = createLocalPerformanceReports(key);

  expect(() => store.retain(binding, report({ cwvQualified: true }))).toThrow(
    'BUILD_FAILED'
  );
  expect(() =>
    store.retain(
      binding,
      report(
        {},
        { buildDigest: 'c'.repeat(64), sourceDigest: binding.sourceDigest }
      )
    )
  ).toThrow('BUILD_FAILED');
});

it('uses a bounded 64-entry memory fallback when no directory is configured', () => {
  const store = createLocalPerformanceReports(key);
  const first = { ...binding };
  store.retain(first, report());
  for (let index = 2; index <= 65; index++) {
    const item = {
      ...binding,
      buildId: `build-${index}`,
      buildDigest: index.toString(16).padStart(64, '0'),
    };
    store.retain(
      item,
      report(
        {},
        { buildDigest: item.buildDigest, sourceDigest: item.sourceDigest }
      )
    );
  }

  expect(store.read(first)).toBeUndefined();
  expect(
    store.read({
      ...binding,
      buildId: 'build-65',
      buildDigest: (65).toString(16).padStart(64, '0'),
    })
  ).toBeDefined();
});

it('keeps durable report files bounded to 64 entries', () => {
  const root = directory();
  const store = createLocalPerformanceReports(key, root);
  for (let index = 1; index <= 65; index++) {
    const item = {
      ...binding,
      buildId: `build-${index}`,
      buildDigest: index.toString(16).padStart(64, '0'),
    };
    store.retain(
      item,
      report(
        {},
        { buildDigest: item.buildDigest, sourceDigest: item.sourceDigest }
      )
    );
  }

  expect(
    readdirSync(root).filter((name) => name.endsWith('.json'))
  ).toHaveLength(64);
  const latest = {
    ...binding,
    buildId: 'build-65',
    buildDigest: (65).toString(16).padStart(64, '0'),
  };
  expect(store.read(latest)).toBeDefined();
});
