import { createDataSchema, extractEdges, pickString } from './loose-schemas';
import { analysePayoutReadback } from './payout-analysis';
import { type GoalOwner, runGoalVariant } from './proof-7-goal-variants';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { qaIdentityFor } from './provider-ops';
import { discoverQaCustomer } from './qa-discovery';
import type { Answer, ProofResult } from './types';

const TITLE = 'Main-wallet interest routing at creation';
const ERROR_CODE_KEYS = ['code', 'error_code', 'errorCode'] as const;

function errorCodeField(envelope: unknown): string | null {
  const code = pickString(envelope, ERROR_CODE_KEYS);
  return code !== null && /^[A-Za-z0-9_.:-]{1,40}$/.test(code)
    ? code
    : code === null
      ? null
      : 'present';
}

export async function runProof7(ctx: ProofContext): Promise<ProofResult> {
  const { api, state, redactor, mode } = ctx;
  const b = new ProofBuilder('p7', TITLE);
  const business = ctx.businessWalletId;
  if (mode === 'live-readonly') {
    return b
      .skip('needs --live-sandbox-mutations: this proof creates a QA customer')
      .build(ctx);
  }
  if (!business) {
    return b
      .skip(
        'no Ogabassey business sandbox wallet configured (set PVB_PROOF_BUSINESS_WALLET_ID)'
      )
      .build(ctx);
  }
  redactor.register('W', business);
  // Interest settings cannot be changed after creation, so this needs a NEW
  // customer; its key is derived from the selected allowlisted QA key.
  // Each attempt gets its own customer (settings cannot be re-applied to an
  // existing one); the key stays within the 64-char journal limit.
  const qa7 = qaIdentityFor(`${ctx.qa.qaKey.slice(0, 57)}-p7a${ctx.attempt}`);
  for (const value of [
    qa7.qaKey,
    qa7.thirdPartyIdentifier,
    qa7.goalWalletName,
  ]) {
    redactor.register('Q', value);
  }

  // 1. Create the customer with accrual on and the payout wallet set.
  const created = await api.createCustomerWithPayout(
    qa7,
    business,
    'p7/create'
  );
  let customerId: string | null = null;
  let mainWalletId: string | null = null;
  let fresh: boolean | null = null;
  let accepted: boolean | null = null;
  if (created.kind === 'resumed') {
    b.inconclusive('customer creation already executed in an earlier run');
    b.note(
      `The creation slot was already used (${created.priorOutcome}); it is never resent. Use --new-attempt to repeat it. The customer is rediscovered read-only.`
    );
    customerId = (await discoverQaCustomer(api, qa7)).customerId;
    if (customerId) {
      const wallets = await api.customerWallets(customerId, 'ASC');
      mainWalletId = pickString(extractEdges(wallets.data).edges[0], ['id']);
    }
  } else {
    const call = created.call;
    b.value('create_http_status', call.httpStatus).value(
      'create_outcome',
      created.outcome
    );
    accepted = call.ok ? true : created.outcome === 'rejected' ? false : null;
    b.finding(
      'customer_create_with_payout_accepted',
      'Does POST /customers accept enable_interest_accrual=true with interest_payout_wallet set to the business wallet?',
      answerOf(accepted)
    );
    if (call.ok) {
      const parsed = createDataSchema.safeParse(call.data);
      if (parsed.success) {
        customerId = parsed.data.customer_id;
        mainWalletId = parsed.data.wallet_id;
        fresh =
          parsed.data.new_customer === undefined
            ? null
            : parsed.data.new_customer === true;
      }
    } else {
      b.value('create_error_http_status', call.httpStatus);
      b.value('create_error_client_code', call.errorCode);
      b.value(
        'create_error_message',
        call.message ? redactor.message(call.message) : null
      );
      b.value('create_error_field_code', errorCodeField(call.envelope));
      b.shape('POST /customers (rejected)', call.httpStatus, call.envelope);
    }
    b.finding(
      'customer_created_fresh',
      'Was a new customer created (so the settings were actually applied)?',
      call.ok ? answerOf(fresh) : 'unknown'
    );
    if (call.ok && fresh === false) {
      b.inconclusive('the customer already existed');
      b.note(
        'The QA customer already existed, so the interest settings were not re-applied; the readback reflects its original creation, not this request.'
      );
    }
  }
  if (customerId) redactor.register('C', customerId);
  if (mainWalletId) redactor.register('W', mainWalletId);

  // 2. Read the main wallet back: which fields reflect the payout destination?
  let namesDestination: boolean | null = null;
  if (mainWalletId) {
    const wallet = await api.wallet(mainWalletId);
    b.shape('GET /wallet/:id (P7 main wallet)', wallet.httpStatus, wallet.data);
    if (wallet.ok) {
      const facts = analysePayoutReadback(wallet.data, business, mainWalletId);
      namesDestination = facts.matchesTarget.length > 0;
      b.value(
        'main_wallet_interest_field_names',
        facts.interestFieldPaths.join(',') || null
      );
      b.value(
        'main_wallet_rate_field_names',
        facts.rateFieldPaths.join(',') || null
      );
      b.value(
        'main_wallet_payout_field_paths',
        facts.matchesTarget.join(',') || null
      );
      b.value('main_wallet_accrual_enabled', facts.accrualEnabled);
      b.finding(
        'main_wallet_readback_exposes_interest_fields',
        'Does GET /wallet/:id expose interest or payout settings?',
        answerOf(facts.interestFieldPaths.length > 0)
      );
      b.finding(
        'main_wallet_readback_names_payout_destination',
        'Does a readback field equal the payout wallet that was set?',
        answerOf(namesDestination)
      );
      b.finding(
        'main_wallet_accrual_flag_readable',
        'Is the accrual on/off setting readable?',
        answerOf(facts.accrualEnabled !== null)
      );
    }
    const list = await api.customerWallets(customerId ?? '', 'ASC');
    const edge = extractEdges(list.data).edges.find(
      (e) => pickString(e, ['id']) === mainWalletId
    );
    b.value(
      'wallet_list_interest_field_names',
      analysePayoutReadback(
        edge,
        business,
        mainWalletId
      ).interestFieldPaths.join(',') || null
    );
  }
  if (namesDestination === null) {
    for (const [id, question] of [
      [
        'main_wallet_readback_exposes_interest_fields',
        'Does GET /wallet/:id expose interest or payout settings?',
      ],
      [
        'main_wallet_readback_names_payout_destination',
        'Does a readback field equal the payout wallet that was set?',
      ],
      [
        'main_wallet_accrual_flag_readable',
        'Is the accrual on/off setting readable?',
      ],
    ] as const) {
      b.finding(id, question, 'unknown', 'no wallet readback was possible');
    }
  }

  // 3. Goal sub-wallets: own payout left unset (inheritance), and explicit.
  const owner: GoalOwner | null = customerId
    ? { qa: qa7, customerId }
    : state.customerId
      ? { qa: ctx.qa, customerId: state.customerId }
      : null;
  if (owner && !customerId) {
    b.note(
      'The P7 customer is unavailable, so the sub-wallet checks ran on the main QA customer.'
    );
  }
  if (owner) {
    const unset = await runGoalVariant(ctx, owner, business, {
      slot: 'p7/goal_unset',
      nameSuffix: `-p7unset-a${ctx.attempt}`,
      payoutWalletId: null,
    });
    const explicit = await runGoalVariant(ctx, owner, business, {
      slot: 'p7/goal_explicit',
      nameSuffix: `-p7explicit-a${ctx.attempt}`,
      payoutWalletId: business,
    });
    const unsetInherits: Answer =
      unset.readback === null
        ? 'unknown'
        : unset.readback.interestFieldPaths.length === 0
          ? 'unknown'
          : answerOf(unset.readback.matchesTarget.length > 0);
    b.finding(
      'goal_without_payout_created',
      'Is a goal sub-wallet with its own payout left unset created?',
      answerOf(unset.exists)
    );
    b.finding(
      'goal_without_payout_inherits_business_payout',
      "Does a goal wallet with no payout of its own inherit the customer's business payout wallet?",
      unsetInherits,
      unsetInherits === 'unknown'
        ? 'readback cannot name a payout destination for this wallet'
        : undefined
    );
    b.finding(
      'goal_explicit_payout_accepted',
      'Does POST /wallet/sub-account accept interest_payout_wallet?',
      answerOf(explicit.accepted)
    );
    b.finding(
      'goal_explicit_readback_names_payout_destination',
      'Does the explicit goal wallet readback name that payout wallet?',
      explicit.readback === null
        ? 'unknown'
        : answerOf(explicit.readback.matchesTarget.length > 0)
    );
    b.value(
      'goal_explicit_error_message',
      explicit.errorMessage ? redactor.message(explicit.errorMessage) : null
    );
    b.value('goal_explicit_http_status', explicit.httpStatus);
    b.value(
      'goal_unset_error_message',
      unset.errorMessage ? redactor.message(unset.errorMessage) : null
    );
    for (const variant of [unset, explicit]) {
      if (variant.resumedOutcome) {
        b.inconclusive('a sub-wallet slot was already executed');
        b.note(
          `A sub-wallet slot was already used (${variant.resumedOutcome}); it is never resent. Use --new-attempt to repeat it.`
        );
      }
    }
    if (unsetInherits === 'yes') {
      b.note(
        'A goal wallet with no payout of its own INHERITS the customer payout wallet: goal interest would reach Ogabassey. Goal wallets must set their payout explicitly.'
      );
    }
  } else {
    for (const id of [
      'goal_without_payout_created',
      'goal_without_payout_inherits_business_payout',
      'goal_explicit_payout_accepted',
      'goal_explicit_readback_names_payout_destination',
    ]) {
      b.finding(
        id,
        id.replaceAll('_', ' '),
        'unknown',
        'no QA customer available'
      );
    }
  }

  // Which routing option the evidence supports.
  const verdict =
    accepted === false
      ? 'create_time_routing_rejected'
      : accepted === true && fresh === true && namesDestination === true
        ? 'create_time_routing_verified'
        : accepted === true && fresh === true && namesDestination === false
          ? 'create_time_routing_accepted_but_unverifiable'
          : 'unconfirmed';
  b.value('interest_routing_verdict', verdict);
  b.note(
    'verdict: verified = accepted and readable, so route at creation; rejected or unverifiable = sweep the interest after it lands with a main to Ogabassey wallet-to-wallet transfer (proofs 2 and 4 cover that transfer).'
  );
  return b.build(ctx);
}
