import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';

const events = new Set([
  'browser_returned',
  'browser_open_failed',
  'pending',
  'confirmed',
  'status_unavailable',
  'session_expired',
  'renewal_started',
  'renewal_succeeded',
  'renewal_failed',
] as const);
type SelfieEvent = typeof events extends Set<infer Event> ? Event : never;

/** Static outcomes only. Never pass selfie frames, URLs, bridge payloads or PII. */
export function recordOxygenSelfieDiagnostic(event: SelfieEvent): void {
  if (!events.has(event)) return;
  try {
    recordCrashBreadcrumb(`oxygen:selfie:${event}`);
  } catch {
    // Diagnostics must never interrupt capture or canonical status recovery.
  }
}
