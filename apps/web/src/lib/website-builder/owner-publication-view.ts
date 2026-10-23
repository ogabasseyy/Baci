import { z } from 'zod';
import { BUILDER_ACCOUNT_LINKING_ENABLED } from '@/config/builder-linking';
import { BUILDER_PRIVATE_STORAGE_ENABLED } from '@/config/builder-private-storage';
import { createClient } from '@/lib/supabase/server';
import type { PublicationConfirmationView } from '@/schemas/builder-publication';
import { loadPublishConfirmation } from './load-publication';
import { getOwnerPublicationRuntime } from './publication-runtime';
export interface InitialPublicationApproval {
  view: PublicationConfirmationView | null;
  error: string | null;
  signedOut: boolean;
}
/** Server-render only the linked owner's exact revision; no publication mutation. */
export async function loadInitialPublicationApproval(
  intentId: string
): Promise<InitialPublicationApproval> {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      return {
        view: null,
        error: 'Sign in to Baci to review this publication.',
        signedOut: true,
      };
    if (
      !BUILDER_ACCOUNT_LINKING_ENABLED ||
      !BUILDER_PRIVATE_STORAGE_ENABLED ||
      !getOwnerPublicationRuntime()
    )
      return {
        view: null,
        error: 'Publication approval is not enabled.',
        signedOut: false,
      };
    const id = z.uuid().parse(intentId);
    return {
      view: await loadPublishConfirmation(client, id),
      error: null,
      signedOut: false,
    };
  } catch {
    return {
      view: null,
      error:
        'Could not load this approval. Sign in or request a fresh approval in Baci.',
      signedOut: false,
    };
  }
}
