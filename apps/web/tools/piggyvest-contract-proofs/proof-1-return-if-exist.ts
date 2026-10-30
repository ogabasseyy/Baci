import { createDataSchema, extractEdges, pickString } from './loose-schemas';
import { answerOf, ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import type { ProofResult } from './types';

const TRIVIALLY_DIFFERENT = new Set([
  'id',
  'created_at',
  'updated_at',
  'virtual_account_id',
  'balance',
  'api_customer_id',
]);

function position(ids: string[], target: string | null): string | null {
  const index = target ? ids.indexOf(target) : -1;
  if (index < 0) return null;
  if (ids.length === 1) return 'only';
  return `${index === 0 ? 'first' : index === ids.length - 1 ? 'last' : 'middle'}_of_${ids.length}`;
}

function walletIdsOf(data: unknown): { ids: string[]; edges: unknown[] } {
  const edges = extractEdges(data).edges;
  return {
    edges,
    ids: edges
      .map((edge) => pickString(edge, ['id']))
      .filter((id): id is string => id !== null),
  };
}

export async function runProof1(ctx: ProofContext): Promise<ProofResult> {
  const { api, qa, state, mode } = ctx;
  const b = new ProofBuilder(
    'p1',
    'Create-customer re-POST with returnIfExist=true'
  );
  if (!state.customerId) {
    return b
      .inconclusive('QA customer unavailable: nothing to look up or re-POST')
      .build(ctx);
  }

  // 1. Can the customer be found by third_party_identifier? (GET)
  const lookup = await api.customersByIdentifier(qa.thirdPartyIdentifier);
  const list = extractEdges(lookup.data);
  const found = list.edges.find(
    (edge) => pickString(edge, ['customer_id', 'id']) === state.customerId
  );
  b.shape(
    'GET /customers?third_party_identifier=',
    lookup.httpStatus,
    lookup.data
  );
  b.value('lookup_list_container', list.container).value(
    'lookup_result_count',
    list.edges.length
  );
  b.finding(
    'lookup_by_identifier_finds_customer',
    'Can GET /api/v1/customers?third_party_identifier= find the customer?',
    answerOf(lookup.ok ? Boolean(found) : null)
  );
  const listEcho = found ? pickString(found, ['third_party_identifier']) : null;
  b.finding(
    'list_echoes_identifier',
    'Does the customer list row echo third_party_identifier?',
    found ? answerOf(listEcho === qa.thirdPartyIdentifier) : 'unknown'
  );

  // 2. Re-POST with returnIfExist=true (mutation: skipped in read-only mode).
  const baselineWallet = state.createdWalletId ?? state.mainWalletId;
  const baselineIsCreate = state.createdWalletId !== null;
  let sameWallet: boolean | null = null;
  if (mode === 'live-readonly') {
    b.note('Re-POST not run: read-only mode sends GET requests only.');
    for (const [id, question] of REPOST_QUESTIONS)
      b.finding(id, question, 'unknown', 'requires --live-sandbox-mutations');
  } else {
    const repost = await api.createCustomer(qa, 'p1/repost');
    if (repost.kind === 'resumed') {
      b.inconclusive('re-POST already executed in an earlier run');
      b.note(
        `The re-POST slot was already used (${repost.priorOutcome}); it is never resent. Use --new-attempt to repeat it.`
      );
      for (const [id, question] of REPOST_QUESTIONS)
        b.finding(id, question, 'unknown', 'slot already executed');
    } else {
      const parsed = createDataSchema.safeParse(repost.call.data);
      b.shape(
        'POST /customers (re-POST)',
        repost.call.httpStatus,
        repost.call.data
      );
      b.value('repost_http_status', repost.call.httpStatus).value(
        'repost_outcome',
        repost.outcome
      );
      if (!repost.call.ok || !parsed.success) {
        b.inconclusive('re-POST did not return a parseable success response');
        for (const [id, question] of REPOST_QUESTIONS)
          b.finding(id, question, 'unknown', 'no parseable response');
      } else {
        sameWallet = baselineWallet
          ? parsed.data.wallet_id === baselineWallet
          : null;
        b.finding(
          'repost_returns_same_wallet_id',
          'Does the re-POST return the SAME wallet_id as the original create?',
          answerOf(sameWallet),
          baselineIsCreate
            ? "baseline: wallet_id from this run's own create call"
            : 'baseline: earliest-created wallet (this run did not create the customer)'
        );
        b.finding(
          'repost_returns_same_customer_id',
          'Does the re-POST return the same customer_id?',
          answerOf(parsed.data.customer_id === state.customerId)
        );
        b.finding(
          'repost_reports_existing_customer',
          'Does the re-POST report new_customer:false?',
          answerOf(
            parsed.data.new_customer === undefined
              ? null
              : parsed.data.new_customer === false
          )
        );
        const echoed = (repost.call.data as Record<string, unknown>)
          .third_party_identifier;
        b.finding(
          'create_response_echoes_identifier',
          'Is third_party_identifier echoed in the create response?',
          answerOf(echoed === qa.thirdPartyIdentifier)
        );
      }
    }
  }

  // 3. How can the default wallet be identified among the customer's wallets?
  const ground = state.createdWalletId;
  const desc = walletIdsOf(
    (await api.customerWallets(state.customerId, 'DESC')).data
  );
  const ascCall = await api.customerWallets(state.customerId, 'ASC');
  const asc = walletIdsOf(ascCall.data);
  b.shape(
    'GET wallet list (customer_id filter)',
    ascCall.httpStatus,
    ascCall.data
  );
  b.value('wallet_count', asc.ids.length);
  if (ground) {
    b.value(
      'default_wallet_position_default_order',
      position(desc.ids, ground)
    );
    b.value('default_wallet_position_ascending', position(asc.ids, ground));
  } else {
    b.note(
      'No create response in this run, so there is no ground truth for the default wallet; position facts omitted.'
    );
  }
  const dated = asc.edges.map((edge) => ({
    id: pickString(edge, ['id']),
    at: pickString(edge, ['created_at']),
  }));
  const canOrder = dated.length > 0 && dated.every((row) => row.at !== null);
  const earliest = canOrder
    ? [...dated].sort((a, c) => (a.at ?? '').localeCompare(c.at ?? ''))[0]?.id
    : null;
  b.finding(
    'default_wallet_is_earliest_created',
    'Is the default wallet the earliest-created wallet of the customer?',
    ground && canOrder ? answerOf(earliest === ground) : 'unknown',
    canOrder ? undefined : 'wallet list rows carry no creation time'
  );

  const defaultEdge = asc.edges.find(
    (edge) => pickString(edge, ['id']) === ground
  );
  const otherEdges = asc.edges.filter((edge) => edge !== defaultEdge);
  const keys = new Set(
    asc.edges.flatMap((edge) => Object.keys((edge ?? {}) as object))
  );
  const differing = [...keys].filter(
    (key) =>
      !TRIVIALLY_DIFFERENT.has(key) &&
      defaultEdge &&
      otherEdges.some(
        (edge) =>
          JSON.stringify((edge as Record<string, unknown>)[key]) !==
          JSON.stringify((defaultEdge as Record<string, unknown>)[key])
      )
  );
  b.value(
    'wallet_list_fields_differing_default_vs_others',
    differing.sort().join(',') || null
  );
  const flagKey = [...keys].find((key) => /default|primary|main/i.test(key));
  b.finding(
    'explicit_default_flag_in_wallet_list',
    'Does the wallet list carry an explicit default/primary flag?',
    asc.ids.length ? answerOf(flagKey !== undefined) : 'unknown',
    flagKey ? `field name: ${flagKey}` : undefined
  );

  const detail = ground ? await api.wallet(ground) : null;
  if (detail)
    b.shape('GET /wallet/:id (default wallet)', detail.httpStatus, detail.data);
  b.finding(
    'wallet_retrieve_exposes_customer_binding',
    'Does GET /wallet/:id expose api_customer_id (owner binding)?',
    detail
      ? answerOf(pickString(detail.data, ['api_customer_id']) !== null)
      : 'unknown'
  );

  const lookupOk = lookup.ok && Boolean(found);
  b.value(
    'adoption_rule',
    mode === 'live-readonly' || sameWallet === null
      ? 'unconfirmed'
      : !sameWallet
        ? 'not_supported'
        : lookupOk && baselineIsCreate
          ? 'supported'
          : 'unconfirmed'
  );
  b.note(
    "adoption_rule: supported only if the identifier lookup finds the customer AND the re-POST returns the wallet_id of this run's own brand-new create (ground truth). A different wallet is not_supported; agreement with only the earliest-created heuristic stays unconfirmed."
  );
  return b.build(ctx);
}

const REPOST_QUESTIONS: ReadonlyArray<readonly [string, string]> = [
  [
    'repost_returns_same_wallet_id',
    'Does the re-POST return the SAME wallet_id as the original create?',
  ],
  [
    'repost_returns_same_customer_id',
    'Does the re-POST return the same customer_id?',
  ],
  [
    'repost_reports_existing_customer',
    'Does the re-POST report new_customer:false?',
  ],
  [
    'create_response_echoes_identifier',
    'Is third_party_identifier echoed in the create response?',
  ],
];
