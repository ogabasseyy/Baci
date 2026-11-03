import 'server-only';
import { piggyvestDailyReconciliationSchemas as schemas } from '@/schemas/piggyvest-daily-reconciliation';
import {
  type ReconciliationReport,
  runDailyReconciliation,
} from './daily-reconciliation';
import {
  pageReasonOf,
  renderReconciliationEmail,
} from './daily-reconciliation-report';
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
 * the savings flags are off (a rollback cannot hide a stuck transfer).
 */
export const RECONCILIATION_STALE_AFTER_SECONDS = 1800;

const SNAPSHOT_STATEMENT =
  'SELECT piggyvest_primary.read_daily_reconciliation($1::uuid,$2::text,$3::jsonb) AS result';

type Runtime = ReturnType<typeof readPrimaryWalletSavingsRecoveryRuntime>;

export interface DailyReconciliationDeps {
  readRuntime: (env: NodeJS.ProcessEnv) => Runtime;
  createExecutor: typeof createPrimaryWalletEvidenceExecutor;
  readProviderTransfer: typeof readProviderTransfer;
  retrieveWallet: typeof retrievePiggyvestWallet;
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
}

async function defaultSendEmail(message: {
  to: string;
  subject: string;
  textContent: string;
  htmlContent: string;
}) {
  const { sendEmail } = await import('@/lib/zeptomail');
  return await sendEmail({ ...message, emailType: 'notifications' });
}

function defaultDeps(): DailyReconciliationDeps {
  return {
    readRuntime: readPrimaryWalletSavingsRecoveryRuntime,
    createExecutor: createPrimaryWalletEvidenceExecutor,
    readProviderTransfer,
    retrieveWallet: retrievePiggyvestWallet,
    sendEmail: defaultSendEmail,
    emitAlert: emitPiggyvestWebhookAlert,
    now: () => new Date().toISOString(),
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

function buildPorts(
  runtime: NonNullable<Runtime>,
  deps: DailyReconciliationDeps
) {
  const { environment, integrationId } = runtime.configuration;
  const token = runtime.providerToken;
  const baseUrl = getPrimaryWalletProviderOrigin(environment);
  const execute = deps.createExecutor(runtime.reconciliationConfiguration);
  return {
    loadSnapshot: async () => {
      const { rows } = await execute(SNAPSHOT_STATEMENT, [
        integrationId,
        environment,
        JSON.stringify({
          staleAfterSeconds: RECONCILIATION_STALE_AFTER_SECONDS,
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
  if (env.PIGGYVEST_RECONCILIATION_ENABLED !== 'true')
    return { status: 'disabled' };
  const deps = { ...defaultDeps(), ...options.deps };
  let report: ReconciliationReport;
  let runtime: Runtime = null;
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
    try {
      const ports = buildPorts(runtime, deps);
      report = await runDailyReconciliation({ ...ports, now: deps.now });
    } catch {
      // Building the provider and database handles failed: not runnable.
      report = {
        status: 'failed',
        reason: 'not_configured',
        generatedAt: deps.now(),
      };
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
  const reasons = [
    pageReasonOf(report),
    emailed ? null : 'report_email_failed',
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
