import 'server-only';
import { verifyPrefundedCardLegacyProof } from '../../../apps/web/src/lib/piggyvest/prefunded-card-legacy-proof';
import { decryptPrefundedCardLegacyReceipt } from '../../../apps/web/src/lib/piggyvest/prefunded-card-legacy-receipt';
import { prefundedCardLegacyProofSchemas as schemas } from '../../../apps/web/src/schemas/prefunded-card-legacy-proof';

const GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6';
const INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2';
const MERCHANT = '10000000-0000-4000-8000-000000000001';
const CUSTOMER = '10000000-0000-4000-8000-000000000002';
const WALLET = '01M3CQX27G9687EFSF1TKYMPR9';
const PROVIDER_CUSTOMER = 'c096507d-dc32-45d2-9c01-871a27abfd10';
const BUSINESS = '01M2381RG34HQJMHQKE7DWDACR';
const APP_SYSTEM = '7685292944002592802';
const RECEIPT_SYSTEM = '7686901100561231906';
const MAX_RECEIPTS = 100;
const DEADLINE = Date.parse('2026-09-29T15:59:10Z');

export function assertLegacyHistoryFinalizationTime(
  startedAt: number,
  finalizedAt: number
): void {
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finalizedAt) ||
    finalizedAt < startedAt ||
    finalizedAt >= DEADLINE
  )
    throw new Error();
}

export function assertLegacyProofPublicationTime(
  verifiedAt: unknown,
  currentTime: number
): void {
  const verificationTime =
    typeof verifiedAt === 'string' ? Date.parse(verifiedAt) : Number.NaN;
  if (
    !Number.isFinite(verificationTime) ||
    !Number.isFinite(currentTime) ||
    verificationTime >= DEADLINE ||
    currentTime < verificationTime ||
    currentTime >= DEADLINE
  )
    throw new Error();
}

function readOnly(system: string, query: string) {
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s';
DO $$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system())<>'${system}'
THEN RAISE EXCEPTION 'wrong staging database'; END IF; END $$;
${query}
ROLLBACK;`;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error();
  return value as Record<string, unknown>;
}

export async function readPrefundedLegacyHistory({
  query,
  readConfig,
  fetchImplementation,
  now = Date.now,
}: {
  query: (container: string, login: string, sql: string) => Promise<unknown>;
  readConfig: () => unknown;
  fetchImplementation: typeof fetch;
  now?: () => number;
}) {
  let stage = 'scope';
  try {
    const startedAt = now();
    if (!Number.isFinite(startedAt) || startedAt >= DEADLINE) throw new Error();
    stage = 'legacy-database';
    const application = record(
      await query(
        'baci-isolated-savings-db-1',
        'postgres',
        readOnly(
          APP_SYSTEM,
          `
SELECT json_build_object('goalAmountKobo',goal.current_amount*100,'goalStatus',goal.status,
 'completedContributions',(SELECT count(*) FROM public.customer_savings_contributions WHERE goal_id=goal.id AND status='completed'),
 'history',coalesce((SELECT json_agg(json_build_object(
  'integrationId',projection.integration_id,'merchantId',projection.merchant_id,'customerId',projection.customer_id,
  'goalId',projection.goal_id,'contributionId',projection.contribution_id,'providerTransactionId',projection.provider_transaction_id,
  'providerWalletId',projection.provider_wallet_id,'providerCustomerId',projection.provider_customer_id,
  'eventId',projection.event_id,'eventDataId',projection.event_data_id,'amountKobo',projection.amount_kobo,
  'feeKobo',projection.fee_kobo,'reference',projection.reference,'sessionId',projection.session_id,'creditedAt',projection.credited_at))
 FROM piggyvest_staging.goal_inflow_projections projection
 JOIN public.customer_savings_contributions contribution ON contribution.id=projection.contribution_id
  AND contribution.goal_id=projection.goal_id AND contribution.merchant_id=projection.merchant_id
  AND contribution.customer_id=projection.customer_id AND contribution.amount*100=projection.amount_kobo
  AND contribution.status='completed' AND contribution.source_type='piggyvest_inflow'
  AND contribution.idempotency_key='piggyvest:'||projection.provider_transaction_id
 JOIN public.piggyvest_inflow_credits credit ON credit.provider_transaction_id=projection.provider_transaction_id
  AND credit.event_id=projection.event_id AND credit.event_data_id=projection.event_data_id
  AND credit.customer_id=projection.provider_customer_id AND credit.wallet_id=projection.provider_wallet_id
  AND credit.amount_kobo=projection.amount_kobo AND credit.fee_kobo=projection.fee_kobo AND credit.reference=projection.reference
  AND credit.session_id IS NOT DISTINCT FROM projection.session_id AND credit.credited_at=projection.credited_at
 WHERE projection.goal_id=goal.id AND projection.integration_id='${INTEGRATION}'),'[]'::json))
FROM public.customer_savings_goals goal WHERE goal.id='${GOAL}' AND goal.merchant_id='${MERCHANT}' AND goal.customer_id='${CUSTOMER}';`
        )
      )
    );
    if (
      application.goalAmountKobo !== 10000 ||
      application.goalStatus !== 'active' ||
      !Array.isArray(application.history)
    )
      throw new Error();
    const history = application.history.map((value) =>
      schemas.legacy.parse(value)
    );
    if (
      !history.length ||
      history.length !== 1 ||
      history.length > MAX_RECEIPTS ||
      history.length !== application.completedContributions ||
      history[0].amountKobo !== 10000 ||
      history.some(
        (entry) =>
          entry.integrationId !== INTEGRATION ||
          entry.merchantId !== MERCHANT ||
          entry.customerId !== CUSTOMER ||
          entry.goalId !== GOAL ||
          entry.providerWalletId !== WALLET ||
          entry.providerCustomerId !== PROVIDER_CUSTOMER
      )
    )
      throw new Error();
    stage = 'configuration';
    const config = record(readConfig());
    if (
      config.environment !== 'staging' ||
      typeof config.providerSecret !== 'string' ||
      !/^test_key_[A-Za-z0-9]+$/.test(config.providerSecret)
    )
      throw new Error();
    const encryptionKey = schemas.encryptionKey.parse(config.encryptionKey);
    stage = 'receipt-database';
    const receiptResult = record(
      await query(
        'pvb-staging-receipts-db',
        'supabase_admin',
        readOnly(
          RECEIPT_SYSTEM,
          `
SELECT json_build_object('count',(SELECT count(*) FROM public.piggyvest_staging_receipts),
 'receipts',coalesce((SELECT json_agg(json_build_object('receiptId',receipt.id,'sealed',json_build_object(
  'payloadSha256',receipt.payload_sha256,'ciphertext',receipt.ciphertext,'nonce',receipt.nonce,
  'authTag',receipt.auth_tag,'keyVersion',receipt.key_version))) FROM (SELECT id,payload_sha256,ciphertext,nonce,auth_tag,key_version
  FROM public.piggyvest_staging_receipts ORDER BY id LIMIT ${MAX_RECEIPTS}) receipt),'[]'::json));`
        )
      )
    );
    if (
      !Number.isSafeInteger(receiptResult.count) ||
      Number(receiptResult.count) > MAX_RECEIPTS ||
      !Array.isArray(receiptResult.receipts) ||
      receiptResult.receipts.length !== receiptResult.count
    )
      throw new Error();
    stage = 'receipt-decryption';
    const decoded = receiptResult.receipts.map((value) => {
      const receipt = record(value);
      const sealed = schemas.sealed.parse(receipt.sealed);
      const identity = schemas.receiptIdentity.parse({
        receiptId: receipt.receiptId,
        payloadSha256: sealed.payloadSha256,
      });
      const rawPayload = decryptPrefundedCardLegacyReceipt(
        sealed,
        encryptionKey
      );
      let eventId: unknown;
      try {
        eventId = record(
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(rawPayload)
          )
        ).eventId;
      } catch {
        eventId = null;
      }
      return { ...identity, sealed, rawPayload, eventId };
    });
    const proofs = [];
    for (const legacy of history) {
      stage = 'receipt-identity';
      const candidates = decoded.filter(
        (receipt) => receipt.eventId === legacy.eventId
      );
      if (candidates.length !== 1) throw new Error();
      stage = 'provider-reconciliation';
      proofs.push(
        await verifyPrefundedCardLegacyProof({
          configuration: {
            integrationId: INTEGRATION,
            systemIdentifier: APP_SYSTEM,
            webhookSecret: config.providerSecret,
            piggyvest: {
              apiSecret: config.providerSecret,
              expectedBusinessId: BUSINESS,
              expectedCurrency: 'NGN',
            },
          },
          legacy,
          receipt: { ...candidates[0], signature: null, encryptionKey },
          fetchImplementation,
          now,
        })
      );
    }
    const finalizedAt = now();
    assertLegacyHistoryFinalizationTime(startedAt, finalizedAt);
    return {
      appSystemIdentifier: APP_SYSTEM,
      receiptSystemIdentifier: RECEIPT_SYSTEM,
      integrationId: INTEGRATION,
      merchantId: MERCHANT,
      customerId: CUSTOMER,
      goalId: GOAL,
      providerWalletId: WALLET,
      providerCustomerId: PROVIDER_CUSTOMER,
      businessId: BUSINESS,
      principalKobo: 10000,
      history,
      proofs,
      ownerSealed: {
        schemaVersion: 1,
        verifiedAt: new Date(finalizedAt).toISOString(),
        scope: {
          systemIdentifier: APP_SYSTEM,
          integrationId: INTEGRATION,
          businessId: BUSINESS,
          merchantId: MERCHANT,
          customerId: CUSTOMER,
          goalId: GOAL,
          providerWalletId: WALLET,
          providerCustomerId: PROVIDER_CUSTOMER,
          currency: 'NGN',
        },
        credits: proofs.map((proof) => ({
          receiptId: proof.receiptId,
          payloadSha256: proof.payloadSha256,
          originalPayloadIntegrity: 'aead_authenticated',
          provenance: 'provider_reconciliation',
          signatureStatus: 'unavailable',
          providerReconciliation: proof.providerReconciliation,
          legacyProviderTransactionId: proof.legacyProviderTransactionId,
          contributionId: proof.contributionId,
          observation: proof.observation,
        })),
      },
      changesMade: false as const,
    };
  } catch (error) {
    if (
      stage === 'provider-reconciliation' &&
      error instanceof Error &&
      typeof error.cause === 'string' &&
      ['input', 'legacy-fields', 'provider-read', 'provider-match'].includes(
        error.cause
      )
    )
      stage = `provider-reconciliation-${error.cause}`;
    throw new Error(`Legacy history verification refused (${stage})`);
  }
}
