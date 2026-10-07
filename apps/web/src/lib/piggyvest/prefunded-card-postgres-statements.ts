import { z } from 'zod';

import { prefundedCardExecutorProfileSchema } from '@/schemas/prefunded-card-postgres-executor';
import { prefundedCardReplayEnrollmentSchemas } from '@/schemas/prefunded-card-replay-enrollment';

const uuid = z.string().uuid();
const text = z.string().min(1).max(65_536);
const system = z.string().regex(/^[0-9]{1,20}$/);
const integer = z.string().regex(/^(?:0|[1-9][0-9]{0,15})$/);
const json = text.refine((value) => {
  try {
    return typeof JSON.parse(value) === 'object';
  } catch {
    return false;
  }
});
const statement = <T extends readonly z.ZodType[]>(
  textValue: string,
  parameters: T
) => ({ text: textValue, parameters });

export const PREFUNDED_CARD_POSTGRES_STATEMENTS = {
  connectionReady: statement('SELECT true AS result', [] as const),
  checkoutCapability: statement(
    'SELECT prefunded_card.checkout_capability($1::jsonb,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS result',
    [json, uuid, uuid, uuid, integer] as const
  ),
  checkoutReserve: statement(
    'SELECT prefunded_card.checkout_reserve($1::jsonb,$2::jsonb) AS result',
    [json, json] as const
  ),
  checkoutRead: statement(
    'SELECT prefunded_card.checkout_read($1::jsonb,$2::jsonb) AS result',
    [json, json] as const
  ),
  checkoutClaim: statement(
    'SELECT prefunded_card.checkout_claim_initialization($1::jsonb,$2::jsonb) AS result',
    [json, json] as const
  ),
  checkoutComplete: statement(
    'SELECT prefunded_card.checkout_complete_initialization($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb) AS result',
    [json, json, json, json] as const
  ),
  checkoutUncertain: statement(
    'SELECT prefunded_card.checkout_mark_initialization_uncertain($1::jsonb,$2::jsonb,$3::jsonb) AS result',
    [json, json, json] as const
  ),
  checkoutPromote: statement(
    'SELECT prefunded_card.checkout_promote_collection($1::jsonb,$2::jsonb,$3::jsonb) AS result',
    [json, json, json] as const
  ),
  checkoutReconcile: statement(
    'SELECT prefunded_card.checkout_flag_reconciliation($1::jsonb,$2::jsonb) AS result',
    [json, json] as const
  ),
  checkoutRecoveryCandidates: statement(
    'SELECT prefunded_card.checkout_recovery_candidates($1::jsonb,$2::jsonb,$3::integer) AS result',
    [json, json, integer] as const
  ),
  customerCapabilities: statement(
    'SELECT prefunded_card.customer_capabilities($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result',
    [uuid, uuid, uuid, uuid, uuid, text, system, json] as const
  ),
  customerRequest: statement(
    'SELECT prefunded_card.customer_request($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result',
    [uuid, uuid, uuid, uuid, uuid, text, system, json] as const
  ),
  customerStatus: statement(
    'SELECT prefunded_card.customer_status($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::jsonb) AS result',
    [uuid, uuid, uuid, uuid, uuid, text, system, json] as const
  ),
  claimDue: statement(
    'SELECT prefunded_card.claim_due($1::uuid,$2::text,$3::text,$4::integer,$5::uuid,$6::uuid) AS result',
    [uuid, text, system, integer, uuid, uuid] as const
  ),
  finishDispatch: statement(
    'SELECT prefunded_card.finish_dispatch($1::uuid,$2::uuid,$3::text) AS result',
    [uuid, uuid, system] as const
  ),
  readOperation: statement(
    'SELECT prefunded_card.read_operation($1::uuid,$2::text) AS result',
    [uuid, system] as const
  ),
  project: statement(
    'SELECT prefunded_card.project($1::uuid,$2::text) AS result',
    [uuid, system] as const
  ),
  reserve: statement('SELECT prefunded_card.reserve($1::jsonb) AS result', [
    json,
  ] as const),
  claimCollection: statement(
    'SELECT prefunded_card.claim_collection($1::uuid,$2::bigint) AS result',
    [uuid, integer] as const
  ),
  recordCollection: statement(
    'SELECT prefunded_card.record_collection($1::uuid,$2::bigint,$3::text,$4::jsonb) AS result',
    [uuid, integer, text, json] as const
  ),
  claimTransfer: statement(
    'SELECT prefunded_card.claim_transfer($1::uuid,$2::bigint) AS result',
    [uuid, integer] as const
  ),
  recordTransfer: statement(
    'SELECT prefunded_card.record_transfer($1::uuid,$2::bigint,$3::text,$4::jsonb) AS result',
    [uuid, integer, text, json] as const
  ),
  claimReconciliation: statement(
    'SELECT prefunded_card.claim_reconciliation($1::uuid,$2::integer) AS result',
    [uuid, integer] as const
  ),
  completeReconciliation: statement(
    'SELECT prefunded_card.complete_reconciliation($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::jsonb) AS result',
    [uuid, uuid, integer, text, text, json] as const
  ),
  readAuthorization: statement(
    'SELECT prefunded_card.read_authorization($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text) AS result',
    [uuid, uuid, uuid, uuid, uuid, system] as const
  ),
  readTransferEvidence: statement(
    'SELECT prefunded_card.read_transfer_evidence($1::uuid,$2::text) AS result',
    [uuid, system] as const
  ),
  classifyProviderInflow: statement(
    'SELECT prefunded_card.classify_provider_inflow($1::uuid,$2::text,$3::text) AS result',
    [uuid, system, text] as const
  ),
  applyClassifiedInflow: statement(
    'SELECT prefunded_card.apply_classified_inflow($1::uuid,$2::text,$3::text) AS result',
    [uuid, system, text] as const
  ),
  resolveReplayEnrollment: statement(
    'SELECT prefunded_card.resolve_replay_enrollment($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::jsonb) AS result',
    [
      uuid,
      uuid,
      uuid,
      text,
      text,
      system,
      prefundedCardReplayEnrollmentSchemas.serializedHints,
    ] as const
  ),
  authorizationCandidate: statement(
    'SELECT prefunded_card.authorization_candidate($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text) AS result',
    [uuid, uuid, uuid, uuid, uuid, uuid, system] as const
  ),
  provisionAuthorization: statement(
    'SELECT prefunded_card.provision_authorization($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text,$8::jsonb) AS result',
    [uuid, uuid, uuid, uuid, uuid, uuid, system, json] as const
  ),
  evidenceScope: statement(
    'SELECT prefunded_card.evidence_scope($1::uuid,$2::text) AS result',
    [uuid, system] as const
  ),
  recordProviderEvidence: statement(
    'SELECT prefunded_card.record_provider_evidence($1::uuid,$2::text,$3::jsonb) AS result',
    [uuid, system, json] as const
  ),
  evidenceDestinationMapping: statement(
    'SELECT prefunded_card.evidence_destination_mapping($1::uuid,$2::text,$3::text) AS result',
    [uuid, system, text] as const
  ),
  readReversalContext: statement(
    'SELECT prefunded_card.read_reversal_context($1::uuid,$2::text) AS result',
    [uuid, system] as const
  ),
  recordCollectionReversal: statement(
    'SELECT prefunded_card.record_collection_reversal($1::text,$2::jsonb) AS result',
    [system, json] as const
  ),
} as const;

const profiles = {
  checkout_customer: ['checkoutCapability', 'checkoutReserve', 'checkoutRead'],
  checkout_authorizer: [
    'checkoutClaim',
    'checkoutComplete',
    'checkoutUncertain',
    'checkoutPromote',
    'checkoutReconcile',
    'checkoutRecoveryCandidates',
  ],
  customer: ['customerCapabilities', 'customerRequest', 'customerStatus'],
  worker: [
    'connectionReady',
    'claimDue',
    'finishDispatch',
    'readOperation',
    'project',
    'reserve',
    'claimCollection',
    'recordCollection',
    'claimTransfer',
    'recordTransfer',
    'claimReconciliation',
    'completeReconciliation',
    'readAuthorization',
    'readTransferEvidence',
    'classifyProviderInflow',
    'applyClassifiedInflow',
    'resolveReplayEnrollment',
    'readReversalContext',
    'recordCollectionReversal',
  ],
  authorizer: [
    'connectionReady',
    'authorizationCandidate',
    'provisionAuthorization',
  ],
  evidence: [
    'connectionReady',
    'evidenceScope',
    'recordProviderEvidence',
    'evidenceDestinationMapping',
  ],
  reversal: ['readReversalContext', 'recordCollectionReversal'],
} as const;

export function prefundedCardPostgresStatementsForProfile(profile: unknown) {
  return profiles[prefundedCardExecutorProfileSchema.parse(profile)].map(
    (name) => PREFUNDED_CARD_POSTGRES_STATEMENTS[name]
  );
}
