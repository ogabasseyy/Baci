/** Small, dependency-free startup markers. Times are relative to JS entry. */
export type StartupMilestone =
  | 'js_entry'
  | 'error_monitoring_complete'
  | 'router_entry_loaded'
  | 'router_ready'
  | 'root_mounted'
  | 'root_first_layout'
  | 'native_intro_completed'
  | 'native_intro_skipped'
  | 'native_intro_wait_failed'
  | 'native_intro_timeout'
  | 'splash_hide_requested'
  | 'splash_hide_completed'
  | 'splash_hide_failed';

const performanceClock = globalThis.performance;
const now =
  typeof performanceClock?.now === 'function'
    ? performanceClock.now.bind(performanceClock)
    : Date.now.bind(Date);
const startedAt = now();
const recorded = new Set<StartupMilestone>();

export function markStartupTiming(milestone: StartupMilestone) {
  if (recorded.has(milestone)) return;
  recorded.add(milestone);
  console.info(
    '[StartupTiming]',
    milestone,
    Math.max(0, Math.round(now() - startedAt))
  );
}
