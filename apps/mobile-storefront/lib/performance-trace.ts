import { Platform } from 'react-native';
import BaciPerformanceTrace from '../modules/baci-performance-trace';

type TraceDetails = Readonly<Record<string, unknown>>;

const NOOP = (): void => undefined;
const MAX_TRACE_NAME_LENGTH = 127;
const TRACE_PREFIX = 'baci.surface.';
const TRACE_DETAIL_KEYS = new Set([
  'api_level',
  'instance_id',
  'os',
  'renderer',
  'surface',
  'template_id',
  'variant',
]);

const toTraceName = (surface: string, details: TraceDetails): string => {
  const entries = Object.entries(details)
    .filter((entry): entry is [string, string | number | boolean] => {
      const [key, value] = entry;
      return (
        TRACE_DETAIL_KEYS.has(key) &&
        (typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean')
      );
    })
    .map(([key, value]) => `${key}=${String(value).slice(0, 64)}`);

  return entries.reduce(
    (name, entry) => {
      const candidate = `${name}${name.includes('|') ? ';' : '|'}${entry}`;
      return candidate.length <= MAX_TRACE_NAME_LENGTH ? candidate : name;
    },
    `${TRACE_PREFIX}${surface}`.slice(0, MAX_TRACE_NAME_LENGTH)
  );
};

/**
 * Marks an active storefront surface in externally captured Android traces.
 * Android's native Trace API makes this a cheap no-op unless system tracing is
 * active. Other platforms do not install the native module.
 */
export function beginPerformanceTrace(
  surface: string,
  details: TraceDetails = {}
): () => void {
  const nativeTrace = BaciPerformanceTrace;
  if (Platform.OS !== 'android' || !nativeTrace) {
    return NOOP;
  }

  const eventName = toTraceName(surface, details);
  const cookie = nativeTrace.beginAsyncSection(eventName);
  if (cookie === null) return NOOP;

  let ended = false;

  return () => {
    if (ended) return;
    ended = true;
    nativeTrace.endAsyncSection(eventName, cookie);
  };
}
