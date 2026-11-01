import { matchesProviderWalletName } from '@/lib/piggyvest/provider-wallet-name';
import { AMOUNTS_KOBO, FUNDING_FLOOR_KOBO } from './constants';
import {
  createDataSchema,
  isOwnedBy,
  pickString,
  walletDataSchema,
} from './loose-schemas';
import type { ProofContext, WalletView } from './proof-context';
import { discoverQaCustomer, verifiesCreatedCustomer } from './qa-discovery';
import { okData, usableList } from './read-rules';

/**
 * Prepares the QA customer every proof works on: the customer, its default
 * (main) wallet, one goal sub-wallet, and a funded main wallet. Mutating
 * steps run only outside live-readonly and every one is journaled; on a
 * re-run they resume instead of resending and the customer is rediscovered
 * by its third_party_identifier (GET only).
 */

function register(ctx: ProofContext, kind: 'W' | 'C', value: string | null) {
  ctx.redactor.register(kind, value);
}

async function discoverCustomer(ctx: ProofContext): Promise<void> {
  const found = await discoverQaCustomer(ctx.api, ctx.qa);
  if (found.reason === 'ambiguous' || found.reason === 'unverifiable') {
    ctx.state.notes.push(
      `QA customer lookup was ${found.reason}; no customer selected`
    );
    return;
  }
  if (!found.customerId) return;
  ctx.state.customerId = found.customerId;
  // Personal fields are never emitted; registering them makes any stray leak
  // fail the final evidence scan.
  for (const key of ['name', 'email', 'phone', 'bvn']) {
    ctx.redactor.register('N', pickString(found.row, [key]));
  }
}

async function loadWallets(ctx: ProofContext): Promise<void> {
  const { state, api } = ctx;
  const customerId = state.customerId;
  if (!customerId) return;
  const list = usableList(await api.customerWallets(customerId, 'ASC'));
  if (!list) {
    state.notes.push('the customer wallet list could not be read');
    return;
  }
  const views: WalletView[] = [];
  for (const edge of list.edges) {
    const id = pickString(edge, ['id']);
    if (!id) continue;
    register(ctx, 'W', id);
    const detail = await api.wallet(id);
    const owned =
      id === state.createdWalletId ||
      (detail.ok && isOwnedBy(okData(detail), customerId));
    if (owned) state.authorized.add(id);
    else
      state.notes.push(
        'a listed wallet could not be proven QA-owned and is excluded'
      );
    const parsed = walletDataSchema.safeParse(okData(detail));
    views.push({
      id,
      role: 'other',
      createdAt:
        pickString(edge, ['created_at']) ??
        (parsed.success ? (parsed.data.created_at ?? null) : null),
      name:
        pickString(edge, ['name']) ??
        (parsed.success ? (parsed.data.name ?? null) : null),
    });
  }
  state.wallets = views.filter((view) => state.authorized.has(view.id));
}

const AMBIGUOUS_GOAL_NOTE =
  'more than one QA wallet reads as the goal wallet name; none is used as the goal or main wallet and no other goal wallet is created';

/**
 * QA wallets that read as the goal wallet. The sandbox rewrites names (every
 * `-` was gone on 2026-10-31), so this compares letters and digits only and
 * is a set, never a pick: more than one match leaves the goal unassigned.
 */
function goalNamedWallets(ctx: ProofContext): WalletView[] {
  return ctx.state.wallets.filter((wallet) =>
    matchesProviderWalletName(wallet.name, ctx.qa.goalWalletName)
  );
}

function assignRoles(ctx: ProofContext): void {
  const { state } = ctx;
  const named = goalNamedWallets(ctx);
  if (named.length > 1 && !state.notes.includes(AMBIGUOUS_GOAL_NOTE))
    state.notes.push(AMBIGUOUS_GOAL_NOTE);
  const goal = named.length === 1 ? named[0] : undefined;
  state.goalWalletId = goal?.id ?? null;
  const candidates = state.wallets.filter((wallet) => !named.includes(wallet));
  if (
    state.createdWalletId &&
    candidates.some((w) => w.id === state.createdWalletId)
  ) {
    state.mainWalletId = state.createdWalletId;
    state.mainWalletBasis = 'create_response';
  } else {
    const dated = candidates
      .filter((w) => w.createdAt)
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    state.mainWalletId = dated[0]?.id ?? null;
    state.mainWalletBasis = dated[0] ? 'earliest_created_heuristic' : 'none';
  }
  for (const wallet of state.wallets) {
    wallet.role =
      wallet.id === state.mainWalletId
        ? 'main'
        : wallet.id === goal?.id
          ? 'goal'
          : 'other';
  }
}

async function ensureGoalWallet(ctx: ProofContext): Promise<void> {
  const { api, qa, state } = ctx;
  if (state.goalWalletId || !state.customerId) return;
  if (goalNamedWallets(ctx).length > 1) return;
  const created = await api.createGoalWallet(
    qa,
    state.customerId,
    'scenario/goal'
  );
  if (created.kind === 'resumed') {
    state.notes.push(
      `goal wallet slot resumed from journal (${created.priorOutcome})`
    );
  } else if (created.call.ok && created.call.typedAccepted) {
    const id = pickString(okData(created.call), ['id']);
    if (id) {
      register(ctx, 'W', id);
      state.authorized.add(id);
    }
  } else if (created.outcome === 'indeterminate') {
    state.notes.push(
      'goal wallet creation outcome unknown; re-listing before trusting it'
    );
  }
  // A new wallet may not be listed yet: re-list within the polling budget.
  for (
    let attempt = 0;
    attempt < ctx.maxPolls &&
    !state.goalWalletId &&
    goalNamedWallets(ctx).length < 2;
    attempt += 1
  ) {
    await loadWallets(ctx);
    assignRoles(ctx);
    if (!state.goalWalletId) await ctx.sleep(ctx.pollIntervalMs);
  }
  if (!state.goalWalletId)
    state.notes.push('goal wallet unavailable after creation attempt');
}

async function ensureFundedMain(ctx: ProofContext): Promise<void> {
  const { api, qa, state } = ctx;
  if (!state.mainWalletId) {
    state.notes.push('main wallet could not be identified; funding skipped');
    return;
  }
  const before = walletDataSchema.safeParse(
    okData(await api.wallet(state.mainWalletId))
  );
  if (!before.success) {
    state.notes.push(
      'main wallet balance could not be read; funding skipped (not assumed to be empty)'
    );
    return;
  }
  const balance = before.data.balance;
  if (balance >= FUNDING_FLOOR_KOBO) return;
  const funded = await api.fundWallet(
    qa,
    state.mainWalletId,
    AMOUNTS_KOBO.fundMain,
    'scenario/fund_main'
  );
  if (funded.kind === 'resumed') {
    state.notes.push(
      `main funding slot resumed from journal (${funded.priorOutcome}); not re-funded`
    );
    return;
  }
  for (let poll = 0; poll < ctx.maxPolls; poll += 1) {
    const now = walletDataSchema.safeParse(
      okData(await api.wallet(state.mainWalletId))
    );
    if (now.success && now.data.balance > balance) return;
    await ctx.sleep(ctx.pollIntervalMs);
  }
  state.notes.push(
    'main wallet funding did not settle within the polling window'
  );
}

export async function setupScenario(ctx: ProofContext): Promise<void> {
  const { api, qa, state, mode, redactor } = ctx;
  redactor.register('Q', qa.qaKey);
  redactor.register('Q', qa.thirdPartyIdentifier);
  redactor.register('Q', qa.goalWalletName);
  // The form the sandbox lists it under, which the harness-reference
  // pattern (`pvbproof-...`) no longer catches.
  redactor.register('Q', qa.goalWalletName.replaceAll('-', ''));

  if (mode !== 'live-readonly') {
    const created = await api.createCustomer(qa, 'scenario/create');
    if (created.kind === 'resumed') {
      state.notes.push(
        `customer create slot resumed from journal (${created.priorOutcome}); rediscovering by identifier`
      );
    } else {
      const parsed = createDataSchema.safeParse(okData(created.call));
      if (created.call.ok && parsed.success) {
        // Registered first so nothing the answer named can ever be emitted.
        register(ctx, 'C', parsed.data.customer_id);
        register(ctx, 'W', parsed.data.wallet_id);
        // A brand-new customer was built from this key's own body. Any other
        // answer (existing, or not saying) may be another key's customer, found
        // through a BVN/email collision: it is used only once a lookup by this
        // key's identifier proves it, before any customer-scoped mutation.
        const fresh = parsed.data.new_customer === true;
        if (
          !fresh &&
          !(await verifiesCreatedCustomer(api, qa, parsed.data.customer_id))
        ) {
          state.createdNewCustomer = parsed.data.new_customer ?? null;
          state.notes.push(
            'customer create returned an existing customer that is not proven to belong to this QA key (verified lookup by its identifier failed or named another customer); it is refused and nothing was created or moved under it'
          );
          return;
        }
        state.customerId = parsed.data.customer_id;
        state.createdNewCustomer = parsed.data.new_customer ?? null;
        // Only a brand-new customer proves which wallet is the default; an
        // existing customer's re-POST answer is exactly what proof 1 tests.
        state.createdWalletId = fresh ? parsed.data.wallet_id : null;
      } else {
        state.notes.push('customer create did not return usable ids');
      }
    }
  }
  if (!state.customerId) await discoverCustomer(ctx);
  if (!state.customerId) {
    state.notes.push('QA customer not found by third_party_identifier');
    return;
  }
  register(ctx, 'C', state.customerId);
  await loadWallets(ctx);
  assignRoles(ctx);
  if (mode === 'live-readonly') return;
  await ensureGoalWallet(ctx);
  assignRoles(ctx);
  await ensureFundedMain(ctx);
}
