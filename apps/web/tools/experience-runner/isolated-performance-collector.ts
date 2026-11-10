import type { CDPSession, Page } from 'playwright-core';
import type {
  AttachedEvent,
  AttachedFrameEvent,
  BindingEvent,
  ContextEvent,
  ContextInfo,
  DestroyedContextEvent,
  FrameTreeNode,
  IsolatedMetric,
  IsolatedPerformanceReport,
  NavigatedFrameEvent,
} from './isolated-performance-collector-types';
import {
  ISOLATED_PERFORMANCE_BINDING,
  ISOLATED_PERFORMANCE_SOURCE,
  ISOLATED_PERFORMANCE_WORLD,
  parseIsolatedMetricPayload,
  scorePostPaintLayoutShifts,
} from './isolated-performance-observer';
import { isolatedReadinessExpression } from './isolated-performance-readiness';

export type {
  IsolatedMetric,
  IsolatedPerformanceReport,
} from './isolated-performance-collector-types';

type Cdp = CDPSession & {
  on(event: string, listener: (value: never) => void): unknown;
};

const finiteMetric = (raw: unknown): IsolatedMetric | null => {
  const parsed = parseIsolatedMetricPayload(raw);
  if (!parsed) return null;
  return {
    ...parsed,
    cls: scorePostPaintLayoutShifts(parsed.rawLayoutShifts, parsed.firstPaintMs)
      .cls,
  };
};

export async function installIsolatedPerformanceCollector(page: Page): Promise<{
  read(): Promise<IsolatedPerformanceReport>;
  close(): Promise<void>;
}> {
  const session = (await page.context().newCDPSession(page)) as Cdp;
  const contexts = new Map<number, ContextInfo>();
  const currentContextByFrame = new Map<string, number>();
  const pendingBindings: Array<{ info: ContextInfo; event: BindingEvent }> = [];
  let frameIds: { host: string; child: string } | null = null;
  let contaminated = false;
  let closed = false;
  let coverageLocked = false;
  const onContext = (event: ContextEvent) => {
    const { context } = event;
    if (!context || typeof context.id !== 'number') {
      contaminated = true;
      return;
    }
    if (context.name === ISOLATED_PERFORMANCE_WORLD) {
      const frameId = context.auxData?.frameId;
      if (!frameId) contaminated = true;
      else {
        const previousId = currentContextByFrame.get(frameId);
        if (previousId !== undefined) contexts.delete(previousId);
        contexts.set(context.id, {
          id: context.id,
          frameId,
          name: context.name,
        });
        currentContextByFrame.set(frameId, context.id);
      }
    }
  };
  const onContextDestroyed = (event: DestroyedContextEvent) => {
    const info = contexts.get(event.executionContextId);
    contexts.delete(event.executionContextId);
    for (let index = pendingBindings.length - 1; index >= 0; index -= 1) {
      if (
        pendingBindings[index]?.event.executionContextId ===
        event.executionContextId
      )
        pendingBindings.splice(index, 1);
    }
    if (
      info &&
      currentContextByFrame.get(info.frameId) === event.executionContextId
    )
      currentContextByFrame.delete(info.frameId);
  };
  const onContextsCleared = () => {
    contexts.clear();
    currentContextByFrame.clear();
    pendingBindings.length = 0;
  };
  const onFrameNavigated = (event: NavigatedFrameEvent) => {
    if (
      coverageLocked &&
      (event.frame.id === frameIds?.host || event.frame.id === frameIds?.child)
    )
      contaminated = true;
  };
  const onFrameAttached = (event: AttachedFrameEvent) => {
    if (
      coverageLocked &&
      event.frameId !== frameIds?.child &&
      event.frameId !== frameIds?.host
    )
      contaminated = true;
  };
  const onBinding = (event: BindingEvent) => {
    const info = contexts.get(event.executionContextId);
    if (!info || event.name !== ISOLATED_PERFORMANCE_BINDING) {
      contaminated = true;
      return;
    }
    if (!frameIds) {
      pendingBindings.push({ info, event });
      return;
    }
    if (info.frameId !== frameIds.host && info.frameId !== frameIds.child) {
      contaminated = true;
      return;
    }
    const metric = finiteMetric(event.payload);
    if (!metric) {
      contaminated = true;
    }
  };
  const onAttached = (event: AttachedEvent) => {
    if (event.targetInfo?.type === 'iframe') contaminated = true;
  };
  session.on(
    'Runtime.executionContextCreated',
    onContext as (value: never) => void
  );
  session.on(
    'Runtime.executionContextDestroyed',
    onContextDestroyed as (value: never) => void
  );
  session.on(
    'Runtime.executionContextsCleared',
    onContextsCleared as (value: never) => void
  );
  session.on('Runtime.bindingCalled', onBinding as (value: never) => void);
  session.on('Target.attachedToTarget', onAttached as (value: never) => void);
  session.on('Page.frameNavigated', onFrameNavigated as (value: never) => void);
  session.on('Page.frameAttached', onFrameAttached as (value: never) => void);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: ISOLATED_PERFORMANCE_SOURCE,
    worldName: ISOLATED_PERFORMANCE_WORLD,
  });
  await session.send('Runtime.addBinding', {
    name: ISOLATED_PERFORMANCE_BINDING,
    executionContextName: ISOLATED_PERFORMANCE_WORLD,
  });

  const evaluateContext = async (info: ContextInfo, role: 'host' | 'child') => {
    const roleExpression = isolatedReadinessExpression(role);
    const result = await session.send('Runtime.evaluate', {
      contextId: info.id,
      expression: `(() => {
        const metrics = globalThis[Symbol.for('baci.cwv.metrics')] ?? null;
        if (metrics) metrics.viewport = { width: innerWidth, height: innerHeight };
        return JSON.stringify({ metrics, status: ${roleExpression} });
      })()`,
      returnByValue: true,
    });
    if (typeof result.result?.value !== 'string') return null;
    try {
      const report: unknown = JSON.parse(result.result.value);
      if (!report || typeof report !== 'object') return null;
      const record = report as Record<string, unknown>;
      const metric = finiteMetric(JSON.stringify(record.metrics));
      if (!metric || !record.status || typeof record.status !== 'object')
        return null;
      return { metric, status: record.status as Record<string, unknown> };
    } catch {
      return null;
    }
  };
  return {
    async read() {
      const tree = (await session.send('Page.getFrameTree')) as {
        frameTree?: FrameTreeNode;
      };
      const root = tree.frameTree?.frame;
      const children = tree.frameTree?.childFrames ?? [];
      const hostId = root?.id;
      if (!hostId || children.length !== 1) contaminated = true;
      const child = children[0]?.frame;
      if (hostId && child?.id) frameIds = { host: hostId, child: child.id };
      else frameIds = null;
      for (const pending of pendingBindings.splice(0)) {
        if (
          !frameIds ||
          (pending.info.frameId !== frameIds.host &&
            pending.info.frameId !== frameIds.child)
        ) {
          contaminated = true;
          continue;
        }
        const metric = finiteMetric(pending.event.payload);
        if (!metric) contaminated = true;
      }

      const activeContexts = [...currentContextByFrame.values()]
        .map((id) => contexts.get(id))
        .filter((ctx): ctx is ContextInfo => Boolean(ctx));
      const hostContext = currentContextByFrame.get(hostId ?? '');
      const childContext = currentContextByFrame.get(child?.id ?? '');
      if (
        !hostContext ||
        !childContext ||
        activeContexts.length !== 2 ||
        !frameIds
      )
        contaminated = true;
      coverageLocked = true;
      const hostInfo =
        hostContext === undefined ? undefined : contexts.get(hostContext);
      const childInfo =
        childContext === undefined ? undefined : contexts.get(childContext);
      const hostRead = hostInfo
        ? await evaluateContext(hostInfo, 'host')
        : null;
      const childRead = childInfo
        ? await evaluateContext(childInfo, 'child')
        : null;
      const host = hostRead?.metric ?? null;
      const frame = childRead?.metric ?? null;
      if (!host || !frame || !hostRead || !childRead) contaminated = true;
      if (host?.layoutShiftOverflow || frame?.layoutShiftOverflow)
        contaminated = true;
      const { presentationTimeMs, ...hostData } = host ?? {
        timeOrigin: 0,
        lcpMs: null,
        rawCls: 0,
        firstPaintMs: null,
        rawLayoutShifts: [],
        layoutShiftOverflow: true,
        cls: 0,
        viewport: { width: 0, height: 0 },
        presentationTimeMs: null,
      };
      const { presentationTimeMs: _framePresentation, ...frameData } =
        frame ?? {
          timeOrigin: 0,
          lcpMs: null,
          rawCls: 0,
          firstPaintMs: null,
          rawLayoutShifts: [],
          layoutShiftOverflow: true,
          cls: 0,
          viewport: { width: 0, height: 0 },
          presentationTimeMs: null,
        };
      const usableHost: IsolatedMetric = hostData;
      const usableFrame: IsolatedMetric = frameData;
      if (presentationTimeMs === null || presentationTimeMs === undefined)
        contaminated = true;
      const shiftedFrameLcp =
        usableFrame.lcpMs === null
          ? null
          : Math.max(
              usableHost.lcpMs ?? 0,
              usableFrame.timeOrigin -
                usableHost.timeOrigin +
                usableFrame.lcpMs,
              presentationTimeMs ?? 0
            );
      return {
        host: usableHost,
        frame: { ...usableFrame, lcpMs: shiftedFrameLcp },
        contentVisible:
          hostRead?.status.visible === true &&
          childRead?.status.visible === true,
        imagesDecoded: childRead?.status.imagesDecoded === true,
        contaminated,
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      await session.detach();
    },
  };
}
