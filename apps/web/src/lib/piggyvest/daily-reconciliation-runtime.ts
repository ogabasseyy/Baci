import 'server-only';
import { piggyvestDailyReconciliationSchemas as schemas } from '@/schemas/piggyvest-daily-reconciliation';
import {
  createWalletPageReader,
  type ListWalletPage,
} from './credit-gap-provider-reader';
import { runCreditGapCheck } from './credit-gap-reconciliation';
import { withCreditGap } from './credit-gap-report';
import { buildCreditGapPorts } from './credit-gap-runtime';
import {
  type ReconciliationReport,
  runDailyReconciliation,
} from './daily-reconciliation';
import { sendReconciliationEmail } from './daily-reconciliation-email';
import {
  pageReasonOf,
  renderReconciliationEmail,
} from './daily-reconciliation-report';
import { isPiggyvestFeatureFlagSet } from './piggyvest-feature-on';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { readPrimaryWalletSavingsRecoveryRuntime } from './primary-wallet-savings-runtime';
import { readProviderTransfer } from './provider-transfer-reader';
import { retrievePiggyvestWallet } from './wallets';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

/**
 * Composes the daily reconciliation from the real parts: the database read
 * (evidence login), PiggyVest's transfer status reader, wallet balances, the
 * owner email and the money page. It has its own switch and stays off until
 * the owner sets PIGGYVEST_RECONCILIATION_ENABLED=true; it only reads and
 * never moves money. It uses the recovery reader, so it keeps running when
 * the savings flags are off (a rollback cannot hide a stuck transfer). Each
 * day it reads a different rotating window of wallets and stuck transfers, so
 * a book larger than one window is fully checked across runs.
 */
export const RECONCILIATION_STALE_AFTER_SECONDS = 1800;
/**
 * Provider reads stop starting after this long. The route allows 300 seconds;
 * the slowest read already running (30 seconds) plus the email and page must
 * still fit, so reads get 200.
 */
export const RECONCILIATION_READ_BUDGET_MS = 200_000;

const MS_PER_DAY = 86_400_000;

/**
 * The window position for this run: the UTC day number. Consecutive days move
 * the database window by one page, so every wallet and stuck transfer is
 * returned across runs instead of the same first rows every day.
 */
function rotationSlotOf(nowMs: number): number {
  const slot = Math.floor(nowMs / MS_PER_DAY);
  // Whole, non-negative and within the nine digits the database accepts.
  if (!Number.isSafeInteger(slot) || slot < 0 || slot > 999_999_999)
    throw new Error('Unusable rotation slot');
  return slot;
}

const SNAPSHOT_STATEMENT =
  'SELECT piggyvest_primary.read_daily_reconciliation($1::uuid,$2::text,$3::jsonb) AS result';

type Runtime = ReturnType<typeof readPrimaryWalletSavingsRecoveryRuntime>;
type NullableRuntime = Runtime | null;

export interface DailyReconciliationDeps {
  readRuntime: (env: NodeJS.ProcessEnv) => Runtime;
  createExecutor: typeof createPrimaryWalletEvidenceExecutor;
  readProviderTransfer: typeof readProviderTransfer;
  retrieveWallet: typeof retrievePiggyvestWallet;
  /** Builds the reader for PiggyVest's transaction list (credit-gap check). */
  createWalletPageReader: (transport: {
    environment: 'staging' | 'production';
    token: string;
    fetchImplementation: typeof fetch;
  }) => ListWalletPage;
  sendEmail: (message: {
    to: string;
    subject: string;
    textContent: string;
    htmlContent: string;
  }) => Promise<{ success: boolean }>;
  emitAlert: (
    code: 'PIGGYVEST_RECONCILIATION_MISMATCH',
    detail: { reason: string }
  ) => void;
  now: () => string;
  nowMs: () => number;
}

function defaultDeps(): DailyReconciliationDeps {
  return {
    readRuntime: readPrimaryWalletSavingsRecoveryRuntime,
    createExecutor: createPrimaryWalletEvidenceExecutor,
    readProviderTransfer,
    retrieveWallet: retrievePiggyvestWallet,
    createWalletPageReader,
    sendEmail: sendReconciliationEmail,
    emitAlert: emitPiggyvestWebhookAlert,
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}

export type DailyReconciliationResult =
  | { status: 'disabled' }
  | {
      status: 'reported';
      report: ReconciliationReport['status'];
      emailed: boolean;
      paged: boolean;
    };

function buildPorts(runtime: Runtime, deps: DailyReconciliationDeps) {
  const { environment, integrationId } = runtime.configuration;
  const token = runtime.providerToken;
  const baseUrl = getPrimaryWalletProviderOrigin(environment);
  const execute = deps.createExecutor(runtime.reconciliationConfiguration);
  const listPage = deps.createWalletPageReader({
    environment,
    token,
    fetchImplementation: fetch,
  });
  const creditGap = (expired: () => boolean) =>
    buildCreditGapPorts({
      execute,
      integrationId,
      environment,
      businessId: runtime.businessId,
      rotationSlot: rotationSlotOf(deps.nowMs()),
      listPage,
      expired,
    });
  return {
    creditGap,
    loadSnapshot: async () => {
      const { rows } = await execute(SNAPSHOT_STATEMENT, [
        integrationId,
        environment,
        JSON.stringify({
          staleAfterSeconds: RECONCILIATION_STALE_AFTER_SECONDS,
          rotationSlot: rotationSlotOf(deps.nowMs()),
        }),
      ]);
      const parsed = schemas.snapshotRows.safeParse(rows);
      // The snapshot must be for our business and the cutoff we asked for;
      // anything else is handed on unparsed so the run reports it invalid.
      return parsed.success &&
        parsed.data[0].result.businessId === runtime.businessId &&
        parsed.data[0].result.staleAfterSeconds ===
          RECONCILIATION_STALE_AFTER_SECONDS
        ? parsed.data[0].result
        : { rejected: true };
    },
    readTransfer: async (
      transfer: ReturnType<typeof schemas.stuckTransfer.parse>,
      businessId: string
    ) =>
      (
        await deps.readProviderTransfer({
          reference: transfer.reference,
          expected: {
            amountKobo: transfer.amountKobo,
            source: {
              walletId: transfer.sourceWalletId,
              currency: 'NGN',
              role: 'main',
            },
            destination: {
              walletId: transfer.destinationWalletId,
              currency: 'NGN',
              role: 'goal',
            },
            businessId,
          },
          transport: { environment, token, fetchImplementation: fetch },
        })
      ).outcome,
    readWalletBalance: async (walletId: string) => {
      const wallet = await deps.retrieveWallet({ baseUrl, token }, walletId);
      // A balance counts only from the wallet we asked for, in our business.
      if (wallet.id !== walletId || wallet.business_id !== runtime.businessId)
        throw new Error('Wallet binding mismatch');
      return wallet.balance;
    },
  };
}

export async function runPiggyvestDailyReconciliation(
  options: {
    env?: NodeJS.ProcessEnv;
    deps?: Partial<DailyReconciliationDeps>;
  } = {}
): Promise<DailyReconciliationResult> {
  const env = options.env ?? process.env;
  // Deliberately NOT isPiggyvestFeatureOn: this report only reads, and it is
  // what surfaces stuck transfers, so the master kill switch (or a mistyped
  // value) must not silence it. Only its own flag turns it off.
  if (!isPiggyvestFeatureFlagSet('daily_reconciliation', env))
    return { status: 'disabled' };
  const deps = { ...defaultDeps(), ...options.deps };
  let report: ReconciliationReport;
  let runtime: NullableRuntime = null;
  try {
    runtime = deps.readRuntime(env);
  } catch {
    runtime = null;
  }
  if (!runtime) {
    report = {
      status: 'failed',
      reason: 'not_configured',
      generatedAt: deps.now(),
    };
  } else {
    let ports: ReturnType<typeof buildPorts> | null = null;
    try {
      ports = buildPorts(runtime, deps);
    } catch {
      // Building the provider and database handles failed: not runnable.
      ports = null;
    }
    if (!ports) {
      report = {
        status: 'failed',
        reason: 'not_configured',
        generatedAt: deps.now(),
      };
    } else {
      try {
        const deadlineMs = deps.nowMs() + RECONCILIATION_READ_BUDGET_MS;
        report = await runDailyReconciliation({
          ...ports,
          now: deps.now,
          nowMs: deps.nowMs,
          deadlineMs,
        });
        // Credits PiggyVest made that our ledgers never recorded (and the
        // reverse). Shares the read budget; it only reads.
        if (report.status !== 'failed') {
          const completed = report;
          const gap = await runCreditGapCheck(
            ports.creditGap(() => deps.nowMs() >= deadlineMs)
          ).catch(() => ({
            status: 'failed' as const,
            reason: 'snapshot_unavailable' as const,
          }));
          report = withCreditGap(completed, gap);
        }
      } catch {
        // The configuration was fine; the run itself threw.
        report = {
          status: 'failed',
          reason: 'run_failed',
          generatedAt: deps.now(),
        };
      }
    }
  }
  const address = schemas.reportEmail.safeParse(
    env.PIGGYVEST_RECONCILIATION_REPORT_EMAIL
  );
  let emailed = false;
  if (address.success) {
    const email = renderReconciliationEmail(report);
    try {
      emailed =
        (
          await deps.sendEmail({
            to: address.data,
            subject: email.subject,
            textContent: email.text,
            htmlContent: email.html,
          })
        ).success === true;
    } catch {
      emailed = false;
    }
  }
  // The email-failure marker goes first: the alert reason is clipped at
  // 120 characters and must never lose it behind a long count list.
  const reasons = [
    emailed ? null : 'report_email_failed',
    pageReasonOf(report),
  ];
  const reason = reasons.filter(Boolean).join(' ');
  if (reason) deps.emitAlert('PIGGYVEST_RECONCILIATION_MISMATCH', { reason });
  return {
    status: 'reported',
    report: report.status,
    emailed,
    paged: reason !== '',
  };
}
