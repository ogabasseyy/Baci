import { MutationGate, type MutationIntent } from './mutation-gate';
import { createMemoryJournal } from './mutation-journal';
import { HarnessRefusal } from './safety-guards';

export function code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}

export const SYNTHETIC_EMAIL = 'synthetic+0123456789ab@example.test';

export function makeGate(
  overrides: Partial<ConstructorParameters<typeof MutationGate>[0]> = {}
) {
  const journal = overrides.journal ?? createMemoryJournal();
  let n = 0;
  const gate = new MutationGate({
    mode: 'live-sandbox-mutations',
    journal,
    runId: 'run1',
    attempt: 1,
    isWalletAuthorized: (id) => id.startsWith('qa-wallet-'),
    random: () => `r${String(n++).padStart(7, '0')}`,
    now: () => new Date('2026-10-30T10:00:00Z'),
    ...overrides,
  });
  return { gate, journal };
}

export const transfer = (
  over: Partial<MutationIntent> = {}
): MutationIntent => ({
  slot: 'p2/w2w',
  op: 'wallet_transfer',
  path: '/api/v1/transfer/wallet',
  qaKey: 'qa-customer-1',
  bodyMatch: {
    source: 'qa-wallet-main',
    destination: 'qa-wallet-goal',
    amount: 100_000,
  },
  walletIds: ['qa-wallet-main', 'qa-wallet-goal'],
  amountKobo: 100_000,
  referenceField: 'reference',
  ...over,
});

export function send(
  gate: MutationGate,
  intent: MutationIntent,
  bodyOverrides: Record<string, unknown> = {}
) {
  const begun = gate.begin(intent);
  if (begun.kind !== 'send') throw new Error('expected send');
  const body = JSON.stringify({
    ...intent.bodyMatch,
    reference: begun.reference,
    ...bodyOverrides,
  });
  return { begun, body };
}

export function execute(
  gate: MutationGate,
  intent: MutationIntent,
  outcome: 'accepted' | 'indeterminate' = 'accepted'
) {
  const { begun, body } = send(gate, intent);
  gate.authorizePost(intent.path, body);
  gate.complete(begun.permit, outcome, 202);
  return begun;
}
