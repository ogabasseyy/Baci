import { AMOUNTS_KOBO, FUNDING_FLOOR_KOBO } from './constants';
import {
  createDataSchema,
  isOwnedBy,
  pickString,
  walletDataSchema,
} from './loose-schemas';
import type { ProofContext, WalletView } from './proof-context';
import { discoverQaCustomer } from './qa-discovery';
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

function assignRoles(ctx: ProofContext): void {
  const { state, qa } = ctx;
  const goal = state.wallets.find(
    (wallet) => wallet.name === qa.goalWalletName
  );
  state.goalWalletId = goal?.id ?? null;
  const candidates = state.wallets.filter((wallet) => wallet.id !== goal?.id);
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
    attempt < ctx.maxPolls && !state.goalWalletId;
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

  if (mode !== 'live-readonly') {
    const created = await api.createCustomer(qa, 'scenario/create');
    if (created.kind === 'resumed') {
      state.notes.push(
        `customer create slot resumed from journal (${created.priorOutcome}); rediscovering by identifier`
      );
    } else {
      const parsed = createDataSchema.safeParse(okData(created.call));
      if (created.call.ok && parsed.success) {
        state.customerId = parsed.data.customer_id;
        state.createdNewCustomer = parsed.data.new_customer ?? null;
        // Only a brand-new customer proves which wallet is the default; an
        // existing customer's re-POST answer is exactly what proof 1 tests.
        state.createdWalletId =
          parsed.data.new_customer === true ? parsed.data.wallet_id : null;
        register(ctx, 'W', parsed.data.wallet_id);
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
