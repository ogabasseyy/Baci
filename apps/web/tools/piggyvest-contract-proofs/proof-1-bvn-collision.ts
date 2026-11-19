import { createDataSchema, pickString } from './loose-schemas';
import { answerOf, type ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { bvnCollisionIdentity } from './provider-ops-proofs';
import { okData, pollSettled, usableList } from './read-rules';
import type { Answer } from './types';

/**
 * Proof 1, added step: what does POST /customers?returnIfExist=true answer
 * for a BVN that already has a customer, sent under a DIFFERENT
 * third_party_identifier, email and phone? Whatever comes back is only
 * recorded: no wallet is created and no money moves under it.
 */

const QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    'bvn_collision_accepted',
    'Is a create with an existing BVN under another third_party_identifier accepted?',
  ],
  [
    'bvn_collision_returns_original_customer',
    'Does it return the customer that already holds the BVN?',
  ],
  ['bvn_collision_reports_new_customer', 'Does it report new_customer:true?'],
  [
    'bvn_collision_returns_original_default_wallet',
    "Does it return the original customer's default wallet_id?",
  ],
  [
    'original_identifier_unchanged',
    'Does the original customer still list under its own third_party_identifier afterwards?',
  ],
];

function allUnknown(b: ProofBuilder, reason: string): void {
  b.inconclusive(reason);
  for (const [id, question] of QUESTIONS) b.finding(id, question, 'unknown');
}

export async function runBvnCollision(
  ctx: ProofContext,
  b: ProofBuilder
): Promise<void> {
  const { api, qa, state, mode, redactor } = ctx;
  if (!state.customerId)
    return allUnknown(b, 'QA customer unavailable: no BVN to collide with');
  if (mode === 'live-readonly')
    return allUnknown(b, 'the same-BVN create needs --live-sandbox-mutations');

  const other = bvnCollisionIdentity(qa);
  redactor.register('Q', other.thirdPartyIdentifier);
  for (const value of [other.bvn, other.email, other.phone])
    redactor.register('N', value);
  const sent = await api.createCustomerSameBvn(qa, 'p1/bvn_collision');
  if (sent.kind === 'resumed') {
    b.note(
      `The same-BVN create slot was already used (${sent.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
    );
    return allUnknown(b, 'same-BVN create already executed in an earlier run');
  }
  const { call } = sent;
  b.shape(
    'POST /customers (same BVN, other identifier)',
    call.httpStatus,
    call.ok ? call.data : call.envelope
  );
  b.value('bvn_collision_http_status', call.httpStatus).value(
    'bvn_collision_outcome',
    sent.outcome
  );
  if (!call.ok)
    b.value(
      'bvn_collision_message',
      call.message ? redactor.message(call.message) : null
    );
  b.finding(
    QUESTIONS[0][0],
    QUESTIONS[0][1],
    sent.outcome === 'accepted'
      ? 'yes'
      : sent.outcome === 'rejected'
        ? 'no'
        : 'unknown'
  );
  const parsed = createDataSchema.safeParse(okData(call));
  if (parsed.success) {
    redactor.register('C', parsed.data.customer_id);
    redactor.register('W', parsed.data.wallet_id);
  }
  // A refusal makes the follow-up questions moot; anything else unanswered is unknown.
  const moot: Answer =
    sent.outcome === 'rejected' ? 'not_applicable' : 'unknown';
  const baselineWallet = state.createdWalletId ?? state.mainWalletId;
  const data = parsed.success ? parsed.data : null;
  b.finding(
    QUESTIONS[1][0],
    QUESTIONS[1][1],
    data ? answerOf(data.customer_id === state.customerId) : moot
  );
  b.finding(
    QUESTIONS[2][0],
    QUESTIONS[2][1],
    data
      ? answerOf(data.new_customer === undefined ? null : data.new_customer)
      : moot
  );
  b.finding(
    QUESTIONS[3][0],
    QUESTIONS[3][1],
    data && baselineWallet ? answerOf(data.wallet_id === baselineWallet) : moot
  );

  // Lookups (GET). A brand-new second customer may not be indexed yet.
  const echoing = (
    call2: Awaited<ReturnType<typeof api.customersByIdentifier>>,
    identifier: string
  ) =>
    (usableList(call2)?.edges ?? []).filter(
      (edge) => pickString(edge, ['third_party_identifier']) === identifier
    );
  const otherLookup = await pollSettled(
    { ...ctx, maxPolls: data?.new_customer === true ? ctx.maxPolls : 0 },
    () => api.customersByIdentifier(other.thirdPartyIdentifier),
    (found) => echoing(found, other.thirdPartyIdentifier).length > 0
  );
  const otherRows = echoing(otherLookup.value, other.thirdPartyIdentifier);
  for (const row of otherRows)
    redactor.register('C', pickString(row, ['customer_id', 'id']));
  b.value(
    'other_identifier_lookup',
    !usableList(otherLookup.value)
      ? 'unreadable'
      : otherRows.length === 0
        ? 'none'
        : otherRows.some(
              (row) =>
                pickString(row, ['customer_id', 'id']) === state.customerId
            )
          ? 'original_customer'
          : 'other_customer'
  );
  const original = usableList(
    await api.customersByIdentifier(qa.thirdPartyIdentifier)
  )?.edges.find(
    (edge) => pickString(edge, ['customer_id', 'id']) === state.customerId
  );
  b.finding(
    QUESTIONS[4][0],
    QUESTIONS[4][1],
    original
      ? answerOf(
          pickString(original, ['third_party_identifier']) ===
            qa.thirdPartyIdentifier
        )
      : 'unknown'
  );
  b.note(
    'Same-BVN create: the second identity shares only the BVN (its own synthetic email, phone and identifier). Its answer is recorded and never adopted.'
  );
}
