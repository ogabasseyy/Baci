import type { SupabaseClient } from '@supabase/supabase-js';
import type { PerformanceReader } from './performance-read';
export interface ExperienceOwnerRuntime {
  readPerformance?: PerformanceReader;
  approval?: {
    prepareDraft?(
      client: SupabaseClient,
      approvalId: string,
      signal?: AbortSignal
    ): Promise<unknown>;
    preparePublication?(
      client: SupabaseClient,
      approvalId: string,
      signal?: AbortSignal
    ): Promise<unknown>;
    load(client: SupabaseClient, approvalId: string): Promise<unknown>;
    confirm(
      client: SupabaseClient,
      approvalId: string,
      signal?: AbortSignal
    ): Promise<unknown>;
    loadLifecycle?(
      client: SupabaseClient,
      approvalId: string
    ): Promise<unknown>;
    confirmPublication?(
      client: SupabaseClient,
      approvalId: string,
      signal?: AbortSignal
    ): Promise<unknown>;
    confirmModeExit?(
      client: SupabaseClient,
      approvalId: string,
      signal?: AbortSignal
    ): Promise<unknown>;
  };
  createPreviewLaunch(
    ctx: {
      supabase: SupabaseClient;
      merchantId: string;
      requestOrigin?: string;
      signal?: AbortSignal;
    },
    input: { buildId: string; routeId?: string }
  ): Promise<unknown>;
}
let installed: ExperienceOwnerRuntime | undefined;
/** No automatic installation or future-service import. Task14 owns Node startup. */
export function installExperienceOwnerRuntime(runtime: ExperienceOwnerRuntime) {
  if (installed) throw Error('Experience runtime already installed');
  installed = runtime;
  return () => {
    if (installed === runtime) installed = undefined;
  };
}
export function getExperienceOwnerRuntime() {
  return installed;
}
