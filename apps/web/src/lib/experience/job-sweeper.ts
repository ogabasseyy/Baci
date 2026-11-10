import type { TransientOutputStore } from '../../../tools/experience-runner/transient-output-store';
/** Output-only cleanup deliberately has no Supabase/client capability. */
export function sweepExperienceOutputs(
  store: TransientOutputStore,
  now: number
) {
  store.sweep(now);
}
