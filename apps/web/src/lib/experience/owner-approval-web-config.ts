import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUILDER_OWNER_APPROVAL_ENABLED } from '@/config/builder-owner-approval';
import { createApprovalPreparation } from './approval-preparation';
import { confirmDraftApply, loadDraftApproval } from './approval-service';
import {
  configuredOwnerMtlsFetch,
  ownerMtlsEnvironment,
} from './owner-mtls-config';
import type { ExperienceOwnerRuntime } from './owner-runtime';
import { createVerifierAttestationClient } from './verifier-attestation-client';

/** Only draft apply is available until lifecycle/public verification is qualified. */
export function configuredOwnerApproval(settings: {
  enabled: boolean;
  key?: string;
  previewKey?: string;
  ownerOrigin?: string;
  ownerCert?: string;
  ownerKey?: string;
}): ExperienceOwnerRuntime['approval'] {
  if (
    !settings.enabled ||
    !settings.key ||
    !/^[A-Za-z0-9_-]{43}$/.test(settings.key)
  )
    return undefined;
  const key = Buffer.from(settings.key, 'base64url');
  if (
    key.length !== 32 ||
    key.toString('base64url') !== settings.key ||
    (settings.previewKey !== undefined && settings.previewKey === settings.key)
  )
    return undefined;
  const fetch = configuredOwnerMtlsFetch(settings);
  if (!fetch) return undefined;
  const attest = createVerifierAttestationClient({ key, fetch });
  return {
    load: loadDraftApproval,
    prepareDraft: createApprovalPreparation(attest, 'draft'),
    confirm: async (
      client: SupabaseClient,
      id: string,
      signal?: AbortSignal
    ) => {
      return await confirmDraftApply(client, id, signal);
    },
  };
}

export function getConfiguredOwnerApproval() {
  if (!BUILDER_OWNER_APPROVAL_ENABLED) return undefined;
  return configuredOwnerApproval({
    enabled: true,
    key: process.env.BACI_OWNER_VERIFIER_BRIDGE_KEY,
    previewKey: process.env.BACI_OWNER_PREVIEW_BRIDGE_KEY,
    ...ownerMtlsEnvironment(),
  });
}
