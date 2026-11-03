import 'server-only';

/**
 * Every subsystem that must be proven ready before a new customer may be
 * onboarded onto a PiggyVest-backed wallet. Onboarding needs all of them,
 * so no backed customer can exist before the legacy wallet debits refuse
 * backed wallets, the ledger fences and settlement worker run, every spend
 * path (core, VTU, IMEI, checkout) is fenced, webhook capture is durable
 * and the legacy balance move is in place.
 */
export const PRIMARY_READINESS_IDS = [
  'interest_marker',
  'ledger_fences',
  'settlement_worker',
  'spend_core',
  'vtu',
  'imei',
  'checkout',
  'webhook_capture',
  'legacy_migration',
] as const;

export type PrimaryReadinessId = (typeof PRIMARY_READINESS_IDS)[number];

/** Resolves true only when its subsystem is proven ready. */
export type PrimaryReadinessReader = () => Promise<boolean>;

export type PrimaryReadinessRegistry = Readonly<
  Partial<Record<PrimaryReadinessId, PrimaryReadinessReader>>
>;

export type PrimaryReadinessReport =
  | { status: 'ready' }
  | { status: 'not_ready' | 'unavailable'; missing: PrimaryReadinessId };

/** Placeholder until the subsystem's real reader is registered. */
const notRegistered: PrimaryReadinessReader = async () => false;

/**
 * The shipped readers. None is registered yet, so every id reports not
 * ready and onboarding stays closed. The real readers replace these one by
 * one (interest_marker needs `savings_interest_private.environment_or_null()`).
 */
export const primaryReadinessRegistry: Readonly<
  Record<PrimaryReadinessId, PrimaryReadinessReader>
> = Object.freeze({
  interest_marker: notRegistered,
  ledger_fences: notRegistered,
  settlement_worker: notRegistered,
  spend_core: notRegistered,
  vtu: notRegistered,
  imei: notRegistered,
  checkout: notRegistered,
  webhook_capture: notRegistered,
  legacy_migration: notRegistered,
});

/**
 * Reads each subsystem in order and stops at the first that is not proven
 * ready, so a closed gate costs as few reads as possible. Only a literal
 * `true` counts; a missing reader counts as not ready, and a reader that
 * fails is reported as unavailable (the caller must not treat a transient
 * failure as an authoritative "not ready").
 */
export async function readPrimaryOnboardingReadiness(
  registry: PrimaryReadinessRegistry = primaryReadinessRegistry
): Promise<PrimaryReadinessReport> {
  for (const id of PRIMARY_READINESS_IDS) {
    const reader = Object.hasOwn(registry, id) ? registry[id] : undefined;
    if (typeof reader !== 'function')
      return { status: 'not_ready', missing: id };
    let ready: unknown;
    try {
      ready = await reader();
    } catch {
      return { status: 'unavailable', missing: id };
    }
    if (ready !== true) return { status: 'not_ready', missing: id };
  }
  return { status: 'ready' };
}
