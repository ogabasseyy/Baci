export const ISOLATED_PERFORMANCE_WORLD = 'baci-cwv-observer';
export const ISOLATED_PERFORMANCE_BINDING = '__baciCwvReport';
export const MAX_RAW_LAYOUT_SHIFT_ENTRIES = 128;

export type NativeLayoutShiftEvidence = {
  startTime: number;
  value: number;
  hadRecentInput: boolean;
};

/** Runs only in the named Chromium isolated world; page scripts cannot replace its APIs. */
export const ISOLATED_PERFORMANCE_SOURCE = `(() => {
  const report = {
    timeOrigin: performance.timeOrigin,
    lcpMs: null,
    rawCls: 0,
    firstPaintMs: null,
    rawLayoutShifts: [],
    layoutShiftOverflow: false,
    viewport: { width: innerWidth, height: innerHeight },
    presentationTimeMs: null
  };
  const noteFramePresentation = () => {
    if (report.presentationTimeMs === null) {
      const frame = document.querySelector('iframe');
      if (frame) {
        const rect = frame.getBoundingClientRect();
        let visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
        for (let node = frame; visible && node; node = node.parentElement) {
          const style = getComputedStyle(node);
          visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
        }
        if (visible) report.presentationTimeMs = performance.now();
      }
    }
    requestAnimationFrame(noteFramePresentation);
  };
  requestAnimationFrame(noteFramePresentation);
  let clsWindow = 0;
  let clsWindowStart = null;
  let clsLast = null;
  const addLayoutShift = (entry) => {
    if (!Number.isFinite(entry.startTime) || entry.startTime < 0 || !Number.isFinite(entry.value) || entry.value < 0 || typeof entry.hadRecentInput !== 'boolean') {
      report.invalidObserver = true;
      return;
    }
    if (report.rawLayoutShifts.length < ${MAX_RAW_LAYOUT_SHIFT_ENTRIES}) {
      report.rawLayoutShifts.push({ startTime: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput });
    } else {
      report.layoutShiftOverflow = true;
    }
    if (entry.hadRecentInput) return;
    if (clsLast !== null && (entry.startTime - clsLast >= 1000 || entry.startTime - clsWindowStart >= 5000)) {
      clsWindow = 0;
      clsWindowStart = null;
    }
    if (clsWindowStart === null) clsWindowStart = entry.startTime;
    clsLast = entry.startTime;
    clsWindow += entry.value;
    report.rawCls = Math.max(report.rawCls, clsWindow);
  };
  const sendReport = () => {
    try { globalThis['__baciCwvReport']?.(JSON.stringify(report)); } catch {}
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'largest-contentful-paint' && Number.isFinite(entry.startTime)) report.lcpMs = entry.startTime;
      }
      sendReport();
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) addLayoutShift(entry);
      sendReport();
    }).observe({ type: 'layout-shift', buffered: true });
    if (PerformanceObserver.supportedEntryTypes.includes('paint')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-paint' && Number.isFinite(entry.startTime) && entry.startTime >= 0) {
            report.firstPaintMs = entry.startTime;
          }
        }
        sendReport();
      }).observe({ type: 'paint', buffered: true });
    }
  } catch { report.invalidObserver = true; }
  Object.defineProperty(globalThis, Symbol.for('baci.cwv.metrics'), { value: report, configurable: false });
})();`;

export type IsolatedMetricPayload = {
  timeOrigin: number;
  lcpMs: number | null;
  rawCls: number;
  firstPaintMs: number | null;
  rawLayoutShifts: NativeLayoutShiftEvidence[];
  layoutShiftOverflow: boolean;
  viewport: { width: number; height: number };
  presentationTimeMs?: number | null;
};

export function sessionWindowCLS(entries: NativeLayoutShiftEvidence[]): number {
  let cls = 0;
  let sessionValue = 0;
  let sessionStart: number | null = null;
  let lastShift: number | null = null;
  for (const entry of entries) {
    if (entry.hadRecentInput) continue;
    if (
      lastShift !== null &&
      (entry.startTime - lastShift >= 1000 ||
        (sessionStart !== null && entry.startTime - sessionStart >= 5000))
    ) {
      sessionValue = 0;
      sessionStart = null;
    }
    if (sessionStart === null) sessionStart = entry.startTime;
    lastShift = entry.startTime;
    sessionValue += entry.value;
    cls = Math.max(cls, sessionValue);
  }
  return cls;
}

export function scorePostPaintLayoutShifts(
  entries: NativeLayoutShiftEvidence[],
  firstPaintMs: number | null
): { rawCls: number; cls: number } {
  const rawCls = sessionWindowCLS(entries);
  if (firstPaintMs === null) return { rawCls, cls: rawCls };
  const paintedEntries = entries.filter(
    (entry) => entry.startTime >= firstPaintMs
  );
  return { rawCls, cls: sessionWindowCLS(paintedEntries) };
}

export function parseIsolatedMetricPayload(
  value: unknown
): IsolatedMetricPayload | null {
  if (typeof value !== 'string') return null;
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const expectedKeys = [
      'timeOrigin',
      'lcpMs',
      'rawCls',
      'firstPaintMs',
      'rawLayoutShifts',
      'layoutShiftOverflow',
      'viewport',
      'presentationTimeMs',
    ];
    if (
      Object.keys(record).some((key) => !expectedKeys.includes(key)) ||
      !Array.isArray(record.rawLayoutShifts) ||
      record.rawLayoutShifts.length > MAX_RAW_LAYOUT_SHIFT_ENTRIES ||
      typeof record.layoutShiftOverflow !== 'boolean'
    )
      return null;
    const viewport = record.viewport as Record<string, unknown> | null;
    if (
      !viewport ||
      Object.keys(viewport).some(
        (key) => key !== 'width' && key !== 'height'
      ) ||
      !Number.isFinite(record.timeOrigin) ||
      !(
        record.lcpMs === null ||
        (Number.isFinite(record.lcpMs) && (record.lcpMs as number) >= 0)
      ) ||
      !Number.isFinite(record.rawCls) ||
      (record.rawCls as number) < 0 ||
      (record.firstPaintMs !== null &&
        (!Number.isFinite(record.firstPaintMs) ||
          (record.firstPaintMs as number) < 0)) ||
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      (record.presentationTimeMs !== undefined &&
        !(
          record.presentationTimeMs === null ||
          (Number.isFinite(record.presentationTimeMs) &&
            (record.presentationTimeMs as number) >= 0)
        ))
    )
      return null;
    if ((viewport.width as number) <= 0 || (viewport.height as number) <= 0)
      return null;
    const rawLayoutShifts: NativeLayoutShiftEvidence[] = [];
    let lastStartTime = Number.NEGATIVE_INFINITY;
    for (const shift of record.rawLayoutShifts) {
      if (!shift || typeof shift !== 'object') return null;
      const entry = shift as Record<string, unknown>;
      if (
        Object.keys(entry).some(
          (key) => !['startTime', 'value', 'hadRecentInput'].includes(key)
        ) ||
        !Number.isFinite(entry.startTime) ||
        (entry.startTime as number) < 0 ||
        (entry.startTime as number) < lastStartTime ||
        !Number.isFinite(entry.value) ||
        (entry.value as number) < 0 ||
        typeof entry.hadRecentInput !== 'boolean'
      )
        return null;
      lastStartTime = entry.startTime as number;
      rawLayoutShifts.push({
        startTime: entry.startTime as number,
        value: entry.value as number,
        hadRecentInput: entry.hadRecentInput,
      });
    }
    if (
      !record.layoutShiftOverflow &&
      sessionWindowCLS(rawLayoutShifts) !== record.rawCls
    )
      return null;
    return {
      timeOrigin: record.timeOrigin as number,
      lcpMs: record.lcpMs as number | null,
      rawCls: record.rawCls as number,
      firstPaintMs: record.firstPaintMs as number | null,
      rawLayoutShifts,
      layoutShiftOverflow: record.layoutShiftOverflow,
      viewport: {
        width: viewport.width as number,
        height: viewport.height as number,
      },
      ...(record.presentationTimeMs === undefined
        ? {}
        : { presentationTimeMs: record.presentationTimeMs as number | null }),
    };
  } catch {
    return null;
  }
}
