import 'server-only';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';
import { readPrimaryWalletInflowRuntime } from './primary-wallet-inflow-runtime';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';
import { readPrimaryWalletPaidInterestRuntime } from './primary-wallet-paid-interest-runtime';

/**
 * Whether the primary intakes the worker-host drain replays through can
 * take a delivery on this host. Holding a family's signing key is not
 * enough: with the intake disabled or misconfigured, every replayed
 * delivery of that family is answered 503, so attesting the drain would
 * stop the provider's retries while nothing here could finish them and the
 * rows would run out their attempt budget.
 *
 * Each family asks the runtime readers in the order the replay dispatches
 * (primary-webhook-dispatch.ts): the first reader that does not decline
 * decides, and a reader that throws means the intake is enabled but broken,
 * which the replay answers 503 without trying the next one. Configuration
 * values are never carried into the evidence, only family names.
 */

export type PrimaryIntakeFamily = 'bank' | 'custody' | 'interest';

export interface PrimaryIntakeEvidence {
  /** Families whose primary intake cannot finish a replay on this host. */
  notReady: PrimaryIntakeFamily[];
  /** Enabled legacy bank inflow runtime is broken, independent of key presence. */
  legacyBankInflowUnavailable?: boolean;
}

type Probe = 'ready' | 'off' | 'broken';

function probe(read: () => unknown): Probe {
  try {
    return read() ? 'ready' : 'off';
  } catch {
    return 'broken';
  }
}

export function isPrimaryLegacyBankInflowUnavailable(
  env: NodeJS.ProcessEnv
): boolean {
  return probe(() => readPrimaryWalletInflowRuntime(env)) === 'broken';
}

function firstReaderDecides(reads: readonly (() => unknown)[]): boolean {
  for (const read of reads) {
    const outcome = probe(read);
    if (outcome !== 'off') return outcome === 'ready';
  }
  return false;
}

function bankReadersReady(env: NodeJS.ProcessEnv, fallback: Probe): boolean {
  const inbox = probe(() => readPrimaryWalletBankInboxRuntime('intake', env));
  // A deliberately disabled fallback is valid: the inbox still accepts the
  // family. A configured-but-broken fallback is not, because unknown-wallet
  // receipts can be declined by the inbox and dispatched to that path.
  if (inbox === 'ready') return fallback !== 'broken';
  if (inbox === 'broken') return false;
  return fallback === 'ready';
}

export function collectPrimaryIntakeEvidence(
  env: NodeJS.ProcessEnv,
  now: Date
): PrimaryIntakeEvidence {
  const inflow = probe(() => readPrimaryWalletInflowRuntime(env));
  const ready: Record<PrimaryIntakeFamily, boolean> = {
    bank: bankReadersReady(env, inflow),
    custody: firstReaderDecides([
      () => readPrimaryCardCustodyIntakeRuntime(env, now.getTime()),
    ]),
    interest: firstReaderDecides([
      () => readPrimaryWalletPaidInterestInboxRuntime('intake', env),
      () => readPrimaryWalletPaidInterestRuntime(env, 'intake'),
    ]),
  };
  const families = Object.keys(ready).sort() as PrimaryIntakeFamily[];
  const evidence: PrimaryIntakeEvidence = {
    notReady: families.filter((family) => !ready[family]),
  };
  if (inflow === 'broken') evidence.legacyBankInflowUnavailable = true;
  return evidence;
}

export function primaryIntakeReason(
  evidence: PrimaryIntakeEvidence | undefined
): string | null {
  if (!evidence) return 'PRIMARY_INTAKE_NOT_CHECKED';
  return evidence.notReady.length > 0
    ? `PRIMARY_INTAKE_NOT_READY:${evidence.notReady.join(',')}`
    : null;
}
