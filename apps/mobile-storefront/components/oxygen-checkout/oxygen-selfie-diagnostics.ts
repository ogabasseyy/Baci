import { recordCrashBreadcrumb } from '@/lib/crash-diagnostics';

const events = new Set([
  'page_loaded',
  'page_load_failed',
  'page_http_failed',
  'camera_granted',
  'camera_denied',
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
