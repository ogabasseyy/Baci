import { MockLedger } from './mock-sandbox-ledger';
import {
  type Body,
  type Customer,
  DEFAULT_MOCK_OPTIONS,
  fail,
  type MockOptions,
  type MockReply,
  ok,
  ulid,
  type Wallet,
} from './mock-sandbox-types';

export type { MockOptions, MockReply } from './mock-sandbox-types';
export { DEFAULT_MOCK_OPTIONS } from './mock-sandbox-types';

/** Customers and wallets. Transactions live in MockLedger. */
export class MockSandbox {
  readonly options: MockOptions;
  customers: Customer[] = [];
  wallets: Wallet[] = [];
  readonly ledger = new MockLedger(this);
  /** The Ogabassey business sandbox wallet: exists, owned by no QA customer. */
  readonly businessWalletId = ulid('b', 1);
  private clock = 0;
  private counter = 0;

  constructor(options: Partial<MockOptions> = {}) {
    this.options = { ...DEFAULT_MOCK_OPTIONS, ...options };
  }

  now(): string {
    this.clock += 1;
    return `2026-10-30T10:${String(Math.floor(this.clock / 60)).padStart(2, '0')}:${String(this.clock % 60).padStart(2, '0')}.000Z`;
  }
  id(): number {
    this.counter += 1;
    return this.counter;
  }
  private addWallet(
    customerId: string,
    name: string,
    settings: { payoutWalletId: string | null; interestEnabled: boolean } = {
      payoutWalletId: null,
      interestEnabled: false,
    }
  ): Wallet {
    const n = this.id();
    const wallet: Wallet = {
      id: ulid('w', n),
      customerId,
      name,
      createdAt: this.now(),
      balance: 0,
      withdrawalCount: 0,
      lagged: null,
      ...settings,
      account: `90${String(n).padStart(8, '0')}`,
    };
    this.wallets.push(wallet);
    return wallet;
  }
  private payoutAcceptable(
    id: string,
    mode: 'accepted' | 'rejected' | boolean
  ): boolean {
    const allowed = mode === 'accepted' || mode === true;
    return (
      allowed && (id === this.businessWalletId || Boolean(this.wallet(id)))
    );
  }

  wallet(id: unknown): Wallet | undefined {
    return this.wallets.find((wallet) => wallet.id === id);
  }

  createCustomer(body: Body, returnIfExist: boolean): MockReply {
    const existing = this.customers.find(
      (c) => c.bvn === body.bvn || c.email === body.email
    );
    if (existing) {
      if (!returnIfExist) return fail('An error occurred creating customer');
      const wallets = this.wallets.filter((w) => w.customerId === existing.id);
      const walletId = this.options.repostReturnsOriginalDefault
        ? existing.defaultWalletId
        : (wallets.at(-1)?.id ?? existing.defaultWalletId);
      return ok(
        this.createData(existing, walletId, false),
        'Customer already exists'
      );
    }
    const payout =
      typeof body.interest_payout_wallet === 'string'
        ? body.interest_payout_wallet
        : null;
    if (
      payout &&
      !this.payoutAcceptable(payout, this.options.customerPayoutWallet)
    ) {
      return fail('Invalid interest payout wallet');
    }
    const n = this.id();
    const customer: Customer = {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      bvn: String(body.bvn),
      email: String(body.email),
      phone: String(body.phone),
      name: String(body.name),
      tpi:
        typeof body.third_party_identifier === 'string'
          ? body.third_party_identifier
          : null,
      defaultWalletId: '',
      payoutWalletId: payout,
    };
    customer.defaultWalletId = this.addWallet(customer.id, 'Default Wallet', {
      payoutWalletId: payout,
      interestEnabled: body.enable_interest_accrual === true,
    }).id;
    this.customers.push(customer);
    return ok(
      this.createData(customer, customer.defaultWalletId, true),
      'Customer created successfully'
    );
  }
  private createData(customer: Customer, walletId: string, isNew: boolean) {
    return {
      customer_id: customer.id,
      wallet_id: walletId,
      new_customer: isNew,
      ...(this.options.echoThirdPartyIdentifierOnCreate
        ? { third_party_identifier: customer.tpi }
        : {}),
    };
  }

  listCustomers(query: URLSearchParams): MockReply {
    const tpi = query.get('third_party_identifier');
    const id = query.get('customer_id');
    const edges = this.customers
      .filter((c) => (!tpi || c.tpi === tpi) && (!id || c.id === id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        created_at: this.wallet(c.defaultWalletId)?.createdAt,
        ...(this.options.customerListEchoesIdentifier
          ? { third_party_identifier: c.tpi }
          : {}),
      }));
    const pageInfo = {
      hasNextPage: false,
      endCursor: null,
      previousCursor: null,
    };
    const container = this.options.customerListContainer;
    if (container === 'array') return ok(edges);
    return ok(
      container === 'edges'
        ? { edges, pageInfo }
        : { paginatedPayload: { edges, pageInfo } }
    );
  }

  createWallet(body: Body): MockReply {
    const customer = this.customers.find((c) => c.id === body.customer_id);
    if (!customer) return fail('An error occurred creating wallet');
    if (this.wallets.some((w) => w.name === body.subaccount_name))
      return fail('Wallet name already exists');
    const explicit =
      typeof body.interest_payout_wallet === 'string'
        ? body.interest_payout_wallet
        : null;
    if (
      explicit &&
      !this.payoutAcceptable(explicit, this.options.subAccountAcceptsPayout)
    ) {
      return fail('Invalid interest payout wallet');
    }
    const payoutWalletId =
      explicit ??
      (this.options.subWalletInheritsPayout ? customer.payoutWalletId : null);
    return ok(
      {
        id: this.addWallet(customer.id, String(body.subaccount_name), {
          payoutWalletId,
          interestEnabled: body.enable_interest_accrual === true,
        }).id,
      },
      'Wallet created'
    );
  }

  listWallets(query: URLSearchParams): MockReply {
    const customerId = query.get('customer_id');
    const rows = this.wallets
      .filter((w) => !customerId || w.customerId === customerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (query.get('orderBy') !== 'ASC') rows.reverse();
    const edges = rows.map((w) => ({
      id: w.id,
      name: w.name,
      status: 'active',
      type: 'api',
      virtual_account_id: `va-${w.id}`,
      ...(this.options.walletListIncludesCreatedAt
        ? { created_at: w.createdAt }
        : {}),
      ...(this.options.walletListIncludesCustomerId
        ? { api_customer_id: w.customerId }
        : {}),
    }));
    return ok({
      total_balance: this.wallets.reduce((sum, w) => sum + w.balance, 0),
      paginatedPayload: {
        edges,
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
  }

  retrieveWallet(id: string): MockReply {
    const w = this.wallet(id);
    if (!w) return fail('Failed to fetch single wallet details');
    if (w.lagged) {
      if (w.lagged.readsLeft > 0) {
        w.lagged.readsLeft -= 1;
      } else {
        w.withdrawalCount += w.lagged.count;
        w.lagged = null;
      }
    }
    return ok({
      id: w.id,
      api_customer_id: w.customerId,
      business_id: 'business-00000001',
      virtual_account_id: `va-${w.id}`,
      currency: 'NGN',
      name: w.name,
      status: 'active',
      type: 'api',
      created_at: w.createdAt,
      updated_at: w.createdAt,
      deleted_at: null,
      balance: w.balance,
      withdrawal_count: w.withdrawalCount,
      creation_interest_rate: 0,
      current_interest_rate: 0,
      ...(this.options.payoutReadback === 'fields'
        ? {
            enable_interest_accrual: w.interestEnabled,
            ...(this.options.goalReadbackOmitsPayout &&
            this.customers.find((c) => c.id === w.customerId)
              ?.defaultWalletId !== w.id
              ? {}
              : { interest_payout_wallet: w.payoutWalletId }),
          }
        : {}),
    });
  }

  walletAccounts(id: string): MockReply {
    const w = this.wallet(id);
    if (!w) return fail('Failed to get virtual accounts for wallet');
    return ok([
      {
        account_number: w.account,
        account_name: w.name,
        bank_name: 'FAAS (SANDBOX)',
        paypoint_name: null,
        paypoint_id: null,
      },
    ]);
  }
}
