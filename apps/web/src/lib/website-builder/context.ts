import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuilderIdentity } from '@/lib/builder-connector/types';
export type DraftServiceDependencies = {
  resolveUserClient: (identity: BuilderIdentity) => Promise<SupabaseClient>;
};
