import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuilderToolName } from '@/schemas/builder-mcp';
import type { Database } from '@/types/supabase';

export type {
  ApplyOperationInput,
  CreateDraftInput,
  ListInput,
  OperationInput,
  PreviewInput,
  PublishInput,
  StatusInput,
  UpdateDraftInput,
} from '@/schemas/builder-mcp';
export type {
  DraftResult,
  OperationResult,
  PreviewResult,
  PublishResult,
  QueuedEditResult,
  StorefrontListResult,
  StorefrontStatusResult,
} from '@/schemas/builder-mcp-results';
export type { BuilderToolName };
export type DraftVersion = string;
export type PublishedVersion = string;
export type BuilderPageSlug = 'home';
export type BuilderScope =
  | 'storefront.read'
  | 'storefront.write'
  | 'storefront.publish';
/**
 * Per-request authenticated projection, not JWT claims. Load merchant targets and
 * create consent from the canonical connection on every request; retain token
 * scopes for intersection. Never cache this projection across provisioning.
 */
export interface BuilderIdentity {
  actorUserId: string;
  connectionId: string;
  grantVersion: number;
  scopes: ReadonlySet<BuilderScope>;
  allowedMerchantIds: readonly string[];
  allowCreateStore: boolean;
}
export interface BuilderContext {
  identity: BuilderIdentity;
  merchantId: string;
  supabase: SupabaseClient<Database>;
}
/** Server-resolved owner and canonical connection, never model/token role claims. */
export interface BuilderLiveOwner {
  actorUserId: string;
  userActive: boolean;
  isOwner: boolean;
  merchantId: string | null;
  storeState: 'none' | 'placeholder' | 'established';
  templateId: string | null;
  rendererVersion: string | null;
  now?: Date;
  connection: BuilderIdentity & {
    status: 'active' | 'revoked' | 'expired';
    expiresAt: string | null;
    revokedAt: string | null;
  };
}
export interface BuilderPublishBinding {
  actorUserId: string;
  connectionId: string;
  grantVersion: number;
  storefrontId: string;
  draftVersion: DraftVersion;
  destinationUrl: string;
  pageSlugs: readonly BuilderPageSlug[];
  policyNamespace: 'baci.website-builder';
  policyVersion: number;
}
export interface BuilderPublishIntent extends BuilderPublishBinding {
  intentId: string;
  effectDigest: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}
export interface BuilderPublishExecution extends BuilderPublishBinding {
  effectDigest: string;
  nonceConsumed: boolean;
  approverAuthorized: boolean;
  now?: Date;
}
export type BuilderApprovalVerificationResult =
  | { ok: true; nonce: string }
  | {
      ok: false;
      code:
        | 'APPROVAL_EXPIRED'
        | 'APPROVAL_ALREADY_USED'
        | 'APPROVAL_MISMATCH'
        | 'CONNECTION_REVOKED'
        | 'INSUFFICIENT_SCOPE';
    };
