import {
  MAX_MUTATION_KOBO,
  MAX_RUN_TOTAL_KOBO,
  MUTATION_CAPABLE_MODES,
  type MutationPath,
  type RunMode,
} from './constants';
import {
  type Journal,
  type JournalOutcome,
  newReference,
  slotState,
} from './mutation-journal';
import {
  assertNoRecordingAccount,
  assertSyntheticEmail,
  HarnessRefusal,
} from './safety-guards';

export type MutationOp =
  | 'create_customer'
  | 'create_wallet'
  | 'wallet_transfer'
  | 'bank_transfer'
  | 'test_funding';

export interface MutationIntent {
  slot: string;
  op: MutationOp;
  path: MutationPath;
  qaKey: string;
  /** Fields the POST body MUST carry with exactly these values. */
  bodyMatch: Record<string, string | number | boolean>;
  /** Every provider wallet the request touches; all must be QA-owned. */
  walletIds: readonly string[];
  amountKobo: number | null;
  /** Body field that carries the generated unique reference, if the API has one. */
  referenceField?: string;
}

export interface Permit {
  readonly reference: string;
  readonly slot: string;
}

export type BeginResult =
  | { kind: 'send'; reference: string; permit: Permit }
  | {
      kind: 'resume';
      reference: string;
      outcome: Exclude<JournalOutcome, 'not_sent'> | 'unresolved';
    };

function parseJsonObject(
  text: string | undefined
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text ?? '');
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface Armed {
  intent: MutationIntent;
  reference: string;
  consumed: boolean;
}

export interface MutationGateOptions {
  mode: RunMode;
  journal: Journal;
  runId: string;
  attempt: number;
  isWalletAuthorized: (walletId: string) => boolean;
  now?: () => Date;
  random?: () => string;
}

/**
 * Single choke point for every state-changing request. A mutation needs
 * (1) a permitted mode, (2) QA-owned wallets, (3) capped amounts, (4) a
 * unique reference, (5) a journaled intent, and (6) an exactly-matching
 * request body at send time. Permits are single-use.
 */
export class MutationGate {
  private armed: Armed | null = null;
  private totalKobo = 0;

  constructor(private readonly options: MutationGateOptions) {}

  begin(intent: MutationIntent): BeginResult {
    const { mode, journal, runId, attempt } = this.options;
    if (!MUTATION_CAPABLE_MODES.includes(mode)) {
      throw new HarnessRefusal(
        'MUTATION_IN_READONLY',
        'read-only mode cannot send state-changing requests'
      );
    }
    if (this.armed && !this.armed.consumed) {
      throw new HarnessRefusal(
        'MUTATION_MISMATCH',
        'a mutation is already armed'
      );
    }
    assertNoRecordingAccount('mutation intent', intent);
    for (const walletId of intent.walletIds) {
      if (!this.options.isWalletAuthorized(walletId)) {
        throw new HarnessRefusal(
          'WALLET_NOT_AUTHORIZED',
          'wallet is not owned by an allowlisted QA customer'
        );
      }
    }
    const amount = intent.amountKobo;
    if (amount !== null) {
      if (
        !Number.isInteger(amount) ||
        amount <= 0 ||
        amount > MAX_MUTATION_KOBO ||
        this.totalKobo + amount > MAX_RUN_TOTAL_KOBO
      ) {
        throw new HarnessRefusal(
          'AMOUNT_CAP',
          'amount outside the harness caps'
        );
      }
    }

    const state = slotState(journal, intent.slot, attempt, intent.qaKey);
    if (state.kind === 'executed') {
      return {
        kind: 'resume',
        reference: state.reference,
        outcome: state.outcome,
      };
    }

    const reference = newReference(
      journal,
      intent.op,
      runId,
      this.options.random
    );
    journal.append({
      v: 1,
      ts: (this.options.now?.() ?? new Date()).toISOString(),
      runId,
      phase: 'intent',
      slot: intent.slot,
      attempt,
      op: intent.op,
      reference,
      qaKey: intent.qaKey,
      amountKobo: amount,
    });
    this.totalKobo += amount ?? 0;
    this.armed = { intent, reference, consumed: false };
    return {
      kind: 'send',
      reference,
      permit: { reference, slot: intent.slot },
    };
  }

  /** Called by the guarded fetch immediately before a POST leaves. */
  authorizePost(pathname: string, bodyText: string | undefined): void {
    const armed = this.armed;
    if (!armed || armed.consumed) {
      throw new HarnessRefusal(
        'MUTATION_WITHOUT_INTENT',
        'no journaled intent covers this request'
      );
    }
    const mismatch: () => never = () => {
      throw new HarnessRefusal(
        'MUTATION_MISMATCH',
        'request does not match the journaled intent'
      );
    };
    if (pathname !== armed.intent.path) mismatch();
    const body = parseJsonObject(bodyText);
    if (body === null) mismatch();
    const expected: Record<string, unknown> = { ...armed.intent.bodyMatch };
    if (armed.intent.referenceField) {
      expected[armed.intent.referenceField] = armed.reference;
    }
    for (const [key, value] of Object.entries(expected)) {
      if (body?.[key] !== value) mismatch();
    }
    if (armed.intent.op === 'create_customer') {
      assertSyntheticEmail(body?.email);
    }
    assertNoRecordingAccount('request body', body);
    armed.consumed = true;
  }

  complete(
    permit: Permit,
    outcome: JournalOutcome,
    httpStatus: number | null
  ): void {
    const armed = this.armed;
    if (!armed || armed.reference !== permit.reference) {
      throw new HarnessRefusal('MUTATION_MISMATCH', 'unknown permit');
    }
    // A permit that was never authorised at send time provably sent nothing.
    const finalOutcome: JournalOutcome = armed.consumed ? outcome : 'not_sent';
    this.armed = null;
    this.options.journal.append({
      v: 1,
      ts: (this.options.now?.() ?? new Date()).toISOString(),
      runId: this.options.runId,
      phase: 'outcome',
      slot: armed.intent.slot,
      attempt: this.options.attempt,
      op: armed.intent.op,
      reference: armed.reference,
      qaKey: armed.intent.qaKey,
      amountKobo: armed.intent.amountKobo,
      outcome: finalOutcome,
      httpStatus: finalOutcome === 'not_sent' ? null : httpStatus,
    });
  }

  spentKobo(): number {
    return this.totalKobo;
  }
}
