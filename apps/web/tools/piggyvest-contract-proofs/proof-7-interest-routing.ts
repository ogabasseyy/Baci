import { createDataSchema, pickString } from './loose-schemas';
import { analysePayoutReadback, destinationAnswer } from './payout-analysis';
import type { GoalOwner } from './proof-7-goal-variants';
import { recordGoalWallets } from './proof-7-goals';
import { readbackPayout } from './proof-7-readback';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { qaIdentityFor } from './provider-ops';
import { discoverQaCustomer, verifiesCreatedCustomer } from './qa-discovery';
import { proof7Key } from './qa-keys';
import { okData, usableList } from './read-rules';
import type { ProofResult } from './types';

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
  // customer. Each attempt gets its own (settings cannot be re-applied to an
  // existing one); the key is a hash of the FULL selected QA key, so two QA
  // keys sharing a prefix can never collide.
  const qa7 = qaIdentityFor(proof7Key(ctx.qa.qaKey, ctx.attempt));
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
      const wallets = usableList(await api.customerWallets(customerId, 'ASC'));
      mainWalletId = pickString(wallets?.edges[0], ['id']);
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
      const parsed = createDataSchema.safeParse(okData(call));
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
    const freshQuestion =
      'Was a new customer created (so the settings were actually applied)?';
    if (!call.ok && created.outcome === 'rejected') {
      b.unobservable(
        'customer_created_fresh',
        freshQuestion,
        'the creation request was rejected, so no customer exists to ask about'
      );
    } else {
      b.finding(
        'customer_created_fresh',
        freshQuestion,
        call.ok ? answerOf(fresh) : 'unknown'
      );
    }
    if (call.ok && fresh === false) {
      b.inconclusive('the customer already existed');
      b.note(
        'The QA customer already existed, so the interest settings were not re-applied; the readback reflects its original creation, not this request.'
      );
    }
    // Anything but a brand-new customer may be another key's (returnIfExist
    // matches on BVN or email): it owns sub-wallets below only once a lookup by
    // THIS proof's identifier proves it.
    if (customerId && fresh !== true) {
      if (!(await verifiesCreatedCustomer(api, qa7, customerId))) {
        redactor.register('C', customerId);
        redactor.register('W', mainWalletId);
        customerId = null;
        mainWalletId = null;
        b.inconclusive(
          "the returned customer is not proven to be this proof's"
        );
        b.note(
          'The existing customer returned by the create is not proven to belong to this proof (a lookup by its identifier did not verify it), so nothing was read from or created under it.'
        );
      }
    }
  }
  if (customerId) redactor.register('C', customerId);
  if (mainWalletId) redactor.register('W', mainWalletId);

  // 2. Read the main wallet back: which fields reflect the payout destination?
  // Polled within the budget; interest settings that never appear are `unknown`.
  let namesDestination: boolean | null = null;
  let mainDestinationPaths: string[] = [];
  const mainQuestions = [
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
  ] as const;
  const mainRead = mainWalletId
    ? await readbackPayout(ctx, mainWalletId, business)
    : null;
  if (mainRead) {
    b.shape(
      'GET /wallet/:id (P7 main wallet)',
      mainRead.httpStatus,
      mainRead.data
    );
  }
  const facts = mainRead?.facts ?? null;
  if (mainWalletId && mainRead && facts) {
    const destination = destinationAnswer(facts);
    namesDestination = destination === 'unknown' ? null : destination === 'yes';
    mainDestinationPaths = facts.matchesTarget;
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
    b.finding(mainQuestions[0][0], mainQuestions[0][1], 'yes');
    b.finding(
      mainQuestions[1][0],
      mainQuestions[1][1],
      destination,
      destination === 'unknown'
        ? `no payout destination field appeared in the wallet readback within ${mainRead.polls} reads`
        : undefined
    );
    // An absent flag is "no" only once the readback is complete.
    b.finding(
      mainQuestions[2][0],
      mainQuestions[2][1],
      facts.accrualEnabled !== null
        ? 'yes'
        : mainRead.settled
          ? 'no'
          : 'unknown'
    );
    if (destination === 'unknown') {
      b.inconclusive(
        'the main wallet readback never showed a payout destination field'
      );
    }
    const list = usableList(await api.customerWallets(customerId ?? '', 'ASC'));
    const edge = list?.edges.find(
      (e) => pickString(e, ['id']) === mainWalletId
    );
    b.value(
      'wallet_list_interest_field_names',
      edge
        ? analysePayoutReadback(
            edge,
            business,
            mainWalletId
          ).interestFieldPaths.join(',') || null
        : null
    );
  } else {
    b.inconclusive('the main wallet readback showed no interest settings');
    for (const [id, question] of mainQuestions) {
      b.finding(
        id,
        question,
        'unknown',
        mainRead
          ? `no interest settings appeared in the wallet readback within ${mainRead.polls} reads (or it could not be read)`
          : 'no wallet readback was possible'
      );
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
  await recordGoalWallets(ctx, b, owner, business, mainDestinationPaths);

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
    'verdict: verified = accepted and readable, so route at creation; rejected or unverifiable = sweep the interest after it lands with a main to Ogabassey wallet-to-wallet transfer (proofs 2 and 4 cover that transfer); unconfirmed = the readback never showed a payout destination field within the polling budget, so re-run before deciding.'
  );
  return b.build(ctx);
}
