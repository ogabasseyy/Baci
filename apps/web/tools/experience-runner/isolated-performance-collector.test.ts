import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { installIsolatedPerformanceCollector } from './isolated-performance-collector';
import { sessionWindowCLS } from './isolated-performance-observer';

const metrics = (
  lcpMs: number | null,
  rawLayoutShifts: Array<{
    startTime: number;
    value: number;
    hadRecentInput: boolean;
  }> = [],
  firstPaintMs: number | null = 150
) => ({
  timeOrigin: 1000,
  lcpMs,
  rawCls: sessionWindowCLS(rawLayoutShifts),
  firstPaintMs,
  rawLayoutShifts,
  layoutShiftOverflow: false,
  viewport: { width: 800, height: 600 },
  presentationTimeMs: 600,
});

function fakePage(
  opts: {
    oopif?: boolean;
    noContexts?: boolean;
    imageReady?: boolean;
    overflow?: boolean;
  } = {}
) {
  const listeners = new Map<string, (event: never) => void>();
  const values = new Map<number, unknown>([
    [
      1,
      metrics(500, [
        { startTime: 100, value: 0.8, hadRecentInput: false },
        { startTime: 250, value: 0.02, hadRecentInput: false },
      ]),
    ],
    [
      2,
      metrics(
        400,
        [
          { startTime: 100, value: 0.7, hadRecentInput: false },
          { startTime: 200, value: 0.12, hadRecentInput: false },
        ],
        150
      ),
    ],
    [3, metrics(500)],
  ]);
  const session = {
    on: (event: string, listener: (value: never) => void) =>
      listeners.set(event, listener),
    send: async (method: string, args?: Record<string, unknown>) => {
      if (method === 'Runtime.enable' && !opts.noContexts) {
        listeners.get('Runtime.executionContextCreated')?.({
          context: {
            id: 1,
            name: 'baci-cwv-observer',
            auxData: { frameId: 'host' },
          },
        } as never);
        listeners.get('Runtime.executionContextCreated')?.({
          context: {
            id: 2,
            name: 'baci-cwv-observer',
            auxData: { frameId: 'child' },
          },
        } as never);
      }
      if (method === 'Target.setAutoAttach' && opts.oopif)
        listeners.get('Target.attachedToTarget')?.({
          targetInfo: { type: 'iframe' },
        } as never);
      if (method === 'Page.getFrameTree')
        return {
          frameTree: {
            frame: { id: 'host', url: 'https://store.test' },
            childFrames: [
              { frame: { id: 'child', url: 'https://store.test/frame' } },
            ],
          },
        };
      if (method === 'Runtime.evaluate') {
        const contextId = args?.contextId as number;
        expect(String(args?.expression)).toContain(
          'metrics.viewport = { width: innerWidth, height: innerHeight }'
        );
        const status =
          contextId !== 2
            ? { visible: true, timeOrigin: 1000 }
            : { visible: true, imagesDecoded: opts.imageReady ?? true };
        const value = values.get(contextId) as
          | ReturnType<typeof metrics>
          | undefined;
        return {
          result: {
            value: JSON.stringify({
              metrics: value
                ? {
                    ...value,
                    ...(opts.overflow && contextId === 2
                      ? { layoutShiftOverflow: true }
                      : {}),
                    viewport: { width: 390, height: 844 },
                  }
                : null,
              status,
            }),
          },
        };
      }
      return {};
    },
    detach: async () => undefined,
  };
  const page = {
    context: () => ({ newCDPSession: async () => session }),
    evaluate: async () => {
      throw new Error('main-world evaluation is forbidden');
    },
  } as unknown as Page;
  return { page, listeners };
}

describe('trusted isolated performance collection', () => {
  it('ignores spoofable page-world APIs and reads isolated readiness state', async () => {
    const { page } = fakePage({ imageReady: false });
    const collector = await installIsolatedPerformanceCollector(page);
    const report = await collector.read();
    expect(report.host.lcpMs).toBe(500);
    expect(report.host.rawCls).toBeCloseTo(0.82);
    expect(report.host.cls).toBe(0.02);
    expect(report.frame.rawCls).toBeCloseTo(0.82);
    expect(report.frame.cls).toBe(0.12);
    expect(report.host.viewport).toEqual({ width: 390, height: 844 });
    expect(report.frame.viewport).toEqual({ width: 390, height: 844 });
    expect(report.frame.lcpMs).toBe(600);
    expect(report.contentVisible).toBe(true);
    expect(report.imagesDecoded).toBe(false);
    expect(report.contaminated).toBe(false);
    await collector.close();
  });

  it('marks bounded raw-entry overflow contaminated without erasing CLS diagnostics', async () => {
    const { page } = fakePage({ overflow: true });
    const collector = await installIsolatedPerformanceCollector(page);
    const report = await collector.read();
    expect(report.frame.rawCls).toBe(0.82);
    expect(report.frame.cls).toBe(0.12);
    expect(report.contaminated).toBe(true);
    await collector.close();
  });

  it('fails closed when isolated context coverage is missing or an OOPIF appears', async () => {
    const missing = await installIsolatedPerformanceCollector(
      fakePage({ noContexts: true }).page
    );
    expect((await missing.read()).contaminated).toBe(true);
    await missing.close();
    const attached = fakePage({ oopif: true });
    const oopif = await installIsolatedPerformanceCollector(attached.page);
    expect((await oopif.read()).contaminated).toBe(true);
    await oopif.close();
  });

  it('rejects binding reports from an unknown execution context', async () => {
    const { page, listeners } = fakePage();
    const collector = await installIsolatedPerformanceCollector(page);
    listeners.get('Runtime.bindingCalled')?.({
      name: '__baciCwvReport',
      payload: JSON.stringify(metrics(900)),
      executionContextId: 99,
    } as never);
    expect((await collector.read()).contaminated).toBe(true);
    await collector.close();
  });

  it('replaces destroyed about:blank contexts and flags later navigation', async () => {
    const { page, listeners } = fakePage();
    const collector = await installIsolatedPerformanceCollector(page);
    listeners.get('Runtime.bindingCalled')?.({
      name: '__baciCwvReport',
      payload: JSON.stringify(metrics(350)),
      executionContextId: 1,
    } as never);
    listeners.get('Runtime.executionContextDestroyed')?.({
      executionContextId: 1,
    } as never);
    listeners.get('Runtime.executionContextCreated')?.({
      context: {
        id: 3,
        name: 'baci-cwv-observer',
        auxData: { frameId: 'host' },
      },
    } as never);
    expect((await collector.read()).contaminated).toBe(false);
    listeners.get('Page.frameNavigated')?.({ frame: { id: 'child' } } as never);
    expect((await collector.read()).contaminated).toBe(true);
    await collector.close();
  });
});
