import { z } from 'zod';
import { BRILSTASH_PILOT_LISTING_LIMIT } from '../config/brilstash-feed';

const uuid = z.uuid();
// Revisions travel as decimal strings into PostgreSQL bigint parameters, so
// reject anything above the bigint maximum before it reaches an RPC.
const BIGINT_MAX = '9223372036854775807';
const revision = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((value) => value.length < BIGINT_MAX.length || value <= BIGINT_MAX);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const reference = z.string().trim().min(1).max(1024);
const identifier = z.string().trim().min(1).max(256);
const windowDate = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });
const installation = { p_installation_id: uuid };
const candidate = { ...installation, p_candidate_id: uuid };
const revisioned = { ...installation, p_expected_revision: revision };
const closure = { ...installation, p_closure_revision: revision };
const reviewedIdentity = z.strictObject({
  condition: z.enum(['new', 'used', 'uk_used', 'open_box', 'refurbished']),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
const savedConnection = {
  partnerIdentity: identifier,
  url: z.url({ protocol: /^https$/ }).max(400),
  configurationRevision: identifier,
  requestId: uuid,
  pageProof: digest,
  evidenceReference: reference,
  importsDisabled: z.literal(true),
};

function command(rpc: string, shape: z.ZodRawShape, writes = true) {
  return { rpc, args: z.strictObject(shape), writes };
}

export const brilStashOperatorCommands = {
  'inspect-installation': command(
    'inspect_brilstash_installation',
    installation,
    false
  ),
  'inspect-candidate': command('inspect_brilstash_candidate', candidate, false),
  'inspect-releases': command(
    'inspect_brilstash_releases',
    installation,
    false
  ),
  bind: command('bind_brilstash_installation', {
    p_merchant_id: uuid,
    p_partner_identity: identifier,
    p_single_page_only: z.boolean().default(true),
  }),
  'bind-source-on-demand': command('bind_brilstash_on_demand_installation', {
    p_merchant_id: uuid,
    p_partner_identity: identifier,
  }),
  'retire-installation': command('retire_brilstash_installation', {
    ...revisioned,
    p_reason: reference,
    p_partner_evidence_reference: reference.optional(),
  }),
  'set-builder': command('set_brilstash_builder', {
    ...installation,
    p_builder_user_id: uuid.nullable(),
  }),
  'map-category': command('set_brilstash_category_mapping', {
    ...revisioned,
    p_merchant_category_id: uuid,
    p_partner_category: identifier.nullable(),
  }),
  'approve-listing': command('approve_brilstash_listing_facts', {
    ...revisioned,
    p_kind: z.enum(['product', 'variant', 'offer']),
    p_source_id: uuid,
    p_parent_product_id: uuid,
    p_pilot_slot: z.int().min(1).max(BRILSTASH_PILOT_LISTING_LIMIT),
    p_reviewed_identity: reviewedIdentity,
    p_specifications: reference,
    p_box_contents: reference,
    p_warranty: reference,
    p_evidence_reference: reference,
  }),
  'remap-listing': command('remap_brilstash_listing', {
    ...revisioned,
    p_external_id: identifier,
    p_kind: z.enum(['product', 'variant', 'offer']),
    p_source_id: uuid,
    p_parent_product_id: uuid,
    p_reviewed_identity: reviewedIdentity,
    p_evidence_reference: reference,
  }),
  'approve-stock-withdrawal': command('approve_brilstash_stock_withdrawal', {
    ...revisioned,
    p_external_id: identifier,
    p_evidence_reference: reference,
  }),
  'retire-listing': command('retire_brilstash_listing', {
    ...revisioned,
    p_external_id: identifier,
  }),
  'rotate-credential': command('rotate_brilstash_credential', {
    ...revisioned,
    p_bearer_digest_hex: digest,
    p_overlap_seconds: z.int().min(0).max(3600),
  }),
  'revoke-credential': command('revoke_brilstash_credential', {
    ...revisioned,
    p_credential_id: uuid,
  }),
  'approve-candidate': command('approve_brilstash_candidate', {
    ...candidate,
    p_payload_digest: digest,
  }),
  'record-fresh-installation': command('record_brilstash_fresh_installation', {
    ...installation,
    p_partner_identity: identifier,
    p_evidence_reference: reference,
    p_scheduled_enabled: z.literal(false),
    p_manual_enabled: z.literal(false),
    p_pending_job_count: z.literal(0),
    p_no_prior_import_or_stage: z.literal(true),
  }),
  activate: command('activate_first_brilstash_snapshot', {
    ...candidate,
    p_window_date: windowDate,
    p_evidence_id: uuid,
    p_approval_id: uuid,
  }),
  'configure-drain': command('configure_brilstash_drain_policy', {
    ...installation,
    p_partner_drain_seconds: z.int().min(1).max(86400),
    p_promotion_allowance_seconds: z.int().min(1).max(3600),
    p_protected_until: timestamp.nullable(),
    p_evidence_reference: reference,
  }),
  close: command('close_brilstash_admission', {
    ...candidate,
    p_window_date: windowDate,
  }),
  'observe-closure': command('observe_brilstash_closure', closure),
  'record-drain-evidence': command('record_brilstash_drain_evidence', {
    ...closure,
    p_disposition: z.enum(['committed', 'discarded', 'expired']),
    p_evidence_reference: reference,
  }),
  promote: command('promote_brilstash_snapshot', {
    ...candidate,
    ...closure,
    p_window_date: windowDate,
  }),
  'abort-drain': command('abort_brilstash_drain', closure),
  suspend: command('suspend_brilstash_installation', {
    ...installation,
    p_reason: reference,
  }),
  'suspend-listings': command('suspend_brilstash_listings', {
    ...installation,
    p_reason: reference,
    p_external_ids: z
      .array(identifier)
      .min(1)
      .max(BRILSTASH_PILOT_LISTING_LIMIT),
  }),
  resume: command('resume_brilstash_installation', {
    ...candidate,
    p_suspension_id: uuid,
    p_approval_id: uuid,
    p_window_date: windowDate,
    p_partner_evidence_reference: reference,
    p_off_sale_verified: z.literal(true),
    p_prior_jobs_disposed: z.literal(true),
    p_withdrawn_external_ids: z
      .array(identifier)
      .max(BRILSTASH_PILOT_LISTING_LIMIT),
  }),
  'record-saved-connection': command('record_brilstash_saved_connection', {
    ...installation,
    p_probe_id: uuid,
    p_connection: z.discriminatedUnion('mode', [
      z.strictObject({
        ...savedConnection,
        mode: z.literal('saved'),
      }),
      z.strictObject({
        ...savedConnection,
        mode: z.literal('held'),
        runId: identifier,
        attemptId: identifier,
        stagedResultId: identifier,
      }),
    ]),
  }),
  'check-handoff': {
    rpc: 'check_brilstash_handoff',
    args: z
      .strictObject({
        ...installation,
        p_probe_id: uuid,
        p_verification_id: uuid.optional(),
        p_release_id: uuid.optional(),
      })
      .refine((value) => !value.p_release_id || !!value.p_verification_id),
    writes: false,
  },
  'inspect-enablement': command(
    'inspect_brilstash_enablement',
    installation,
    false
  ),
  'record-enablement-readback': command(
    'record_brilstash_enablement_readback',
    {
      ...installation,
      p_verification_id: uuid,
      p_readback_id: uuid,
      p_observed_revision: identifier,
      p_scheduled_enabled: z.boolean(),
      p_manual_enabled: z.boolean(),
      p_evidence_reference: reference,
    }
  ),
  'record-release-request': command('record_brilstash_release_request', {
    ...installation,
    p_request: z.strictObject({
      generationId: uuid,
      credentialId: uuid,
      catalogueRevision: revision,
      servingRevision: revision,
      credentialRevision: revision,
      payloadDigest: digest,
      configurationRevision: identifier,
      runId: identifier,
      attemptId: identifier,
      stagedResultId: identifier,
      verificationId: uuid,
      applicationDeadline: timestamp,
    }),
  }),
  'record-attempt-disposition': command(
    'record_brilstash_attempt_disposition',
    {
      ...installation,
      p_release_id: uuid,
      p_run_id: identifier,
      p_attempt_id: identifier,
      p_status: z.enum([
        'awaiting_application',
        'partial_application',
        'applied',
        'cancelled_without_application',
        'discarded_without_application',
        'partial_application_reconciled',
      ]),
      p_evidence_reference: reference,
      p_catalogue_state_verified: z.boolean(),
      p_further_jobs_blocked: z.boolean(),
    }
  ),
};
