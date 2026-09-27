import 'server-only';

import {
  createServiceClient,
  type JumiaCredentialServiceClient,
} from '@/lib/supabase/service';

/**
 * Creates the server-only Supabase client for Jumia credential RPCs.
 *
 * Callers must authenticate and authorize the merchant operation before
 * loading a grant. The dedicated sentinel keeps encrypted Jumia credentials
 * separate from the generic event-pipeline and Ads service boundaries.
 */
export function createJumiaCredentialServiceClient(): JumiaCredentialServiceClient {
  return createServiceClient('jumia-credentials');
}

export type { JumiaCredentialServiceClient } from '@/lib/supabase/service';
