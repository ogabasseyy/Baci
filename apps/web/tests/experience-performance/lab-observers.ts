/** Installed independently in host and child; raw lab timing is never field INP. */
export function installLabObservers() {
  const state = {
    lcpMs: null as number | null,
    cls: 0,
    interactionDurationMs: null as number | null,
    sessionStart: 0,
    lastShift: 0,
    sessionValue: 0,
    observed: [] as string[],
  };
  Object.assign(window, { __baciLab: state });
  for (const type of ['largest-contentful-paint', 'layout-shift', 'event']) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'largest-contentful-paint')
          state.lcpMs = entry.startTime;
        if (entry.entryType === 'event')
          state.interactionDurationMs = Math.max(
            state.interactionDurationMs ?? 0,
            entry.duration
          );
        if (entry.entryType === 'layout-shift') {
          const shift = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
          };
          if (shift.hadRecentInput) continue;
          if (
            state.sessionValue === 0 ||
            entry.startTime - state.lastShift >= 1000 ||
            entry.startTime - state.sessionStart >= 5000
          ) {
            state.sessionStart = entry.startTime;
            state.sessionValue = 0;
          }
          state.lastShift = entry.startTime;
          state.sessionValue += shift.value;
          state.cls = Math.max(state.cls, state.sessionValue);
        }
      }
    });
    observer.observe({
      type,
      buffered: true,
      ...(type === 'event' ? { durationThreshold: 16 } : {}),
    });
    state.observed.push(type);
  }
}
export function readLabMetrics() {
  const state = (
    window as Window & {
      __baciLab?: {
        lcpMs: number | null;
        cls: number;
        interactionDurationMs: number | null;
        observed: string[];
      };
    }
  ).__baciLab;
  if (!state) throw Error('LAB_OBSERVER_MISSING');
  return {
    timeOrigin: performance.timeOrigin,
    lcpMs: state.lcpMs,
    cls: state.observed.includes('layout-shift') ? state.cls : null,
    interactionDurationMs: state.interactionDurationMs,
    observed: state.observed,
  };
}
