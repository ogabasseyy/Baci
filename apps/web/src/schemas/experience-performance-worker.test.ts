import { describe, expect, it } from 'vitest';
import {
  performancePublicBootstrap,
  performanceWorkerInput,
  performanceWorkerOutput,
} from './experience-performance-worker';

const input = () => ({
  mode: 'candidate-performance/v1',
  width: 390,
  bundle: {
    hostOrigin: 'http://127.0.0.1:4100',
    javascript: 'export{}',
    css: '',
    digest: 'a'.repeat(64),
    imports: [],
  },
  bootstrap: {
    route: {
      epoch: 0,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: 'public',
    },
    catalog: { products: [], revision: 'public' },
    capabilities: ['catalog.read'],
  },
  assets: [],
});

const output = () => ({
  format: 'baci.performance-sample/v1',
  policyId: 'chromium-native-reference/v1',
  browser: 'Chromium test',
  route: '/',
  width: 390,
  buildDigest: 'a'.repeat(64),
  cache: 'cold-context',
  hostLcpMs: null,
  frameLcpMs: null,
  hostCls: 0,
  frameCls: 0,
  diagnostics: {
    host: {
      rawCls: 0,
      firstPaintMs: null,
      rawLayoutShifts: [],
      layoutShiftOverflow: false,
    },
    frame: {
      rawCls: 0,
      firstPaintMs: null,
      rawLayoutShifts: [],
      layoutShiftOverflow: false,
    },
  },
  interactionDurationMs: null,
  contentVisible: true,
  imagesDecoded: true,
  consoleErrors: 0,
  contaminated: false,
  observationWindowMs: 2000,
});

describe('performance worker schemas', () => {
  it('accepts bounded public bootstrap and worker input fields', () => {
    const value = input();
    expect(performanceWorkerInput.parse(value)).toEqual(value);
    expect(performancePublicBootstrap.parse(value.bootstrap)).toEqual(
      value.bootstrap
    );
  });

  it('rejects private bootstrap fields, invalid routes, and unapproved widths', () => {
    const value = input();
    expect(
      performanceWorkerInput.safeParse({
        ...value,
        bootstrap: { ...value.bootstrap, authToken: 'secret' },
      }).success
    ).toBe(false);
    expect(
      performanceWorkerInput.safeParse({
        ...value,
        width: 800,
      }).success
    ).toBe(false);
    expect(
      performanceWorkerInput.safeParse({
        ...value,
        bootstrap: {
          ...value.bootstrap,
          route: { ...value.bootstrap.route, canonicalPath: '//external' },
        },
      }).success
    ).toBe(false);
  });

  it('validates the worker output protocol and rejects schema extras', () => {
    expect(performanceWorkerOutput.parse(output())).toMatchObject({
      policyId: 'chromium-native-reference/v1',
      observationWindowMs: 2000,
    });
    expect(
      performanceWorkerOutput.safeParse({ ...output(), approved: true }).success
    ).toBe(false);
  });
});
