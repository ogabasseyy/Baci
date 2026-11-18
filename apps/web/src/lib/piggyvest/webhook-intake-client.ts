import 'server-only';
import type { PiggyvestIntakeClient } from './intake-client.types';
import {
  PiggyvestIntakeDbError,
  type PiggyvestWebhookIntakeExecute,
  type PiggyvestWebhookIntakeFunction,
} from './webhook-intake-executor';
import { rpcRoutes } from './webhook-intake-rpc-routes';

/**
 * Allowlisted facade over the receiver's restricted database login.
 *
 * The receiver's processing modules (inbox, quarantine, ledgers, wallet
 * restrictions, outbox terminals) are written against a small query-builder
 * surface. This facade answers exactly the queries those modules issue, each
 * mapped to one SECURITY DEFINER function of the `piggyvest_webhook_intake`
 * schema, and refuses everything else with PGRST_UNSUPPORTED without touching
 * the database. Failures keep the supabase-js `{ data, error }` shape so the
 * modules' existing error handling (including the SQLSTATE `P0001` check of
 * the plan-transfer projection) is unchanged.
 */

type Row = Record<string, unknown>;
type Result = {
  data: unknown;
  error: { code: string; message: string } | null;
};
type Pair = readonly [string, unknown];

const unsupported: Result = {
  data: null,
  error: { code: 'PGRST_UNSUPPORTED', message: 'Query not allowed' },
};

interface TableRoute {
  insert?: PiggyvestWebhookIntakeFunction;
  insertKey?: string;
  read?: PiggyvestWebhookIntakeFunction;
  /** Columns the read function accepts as its single lookup key. */
  readKeys?: readonly string[];
}

const tables: Record<string, TableRoute> = {
  piggyvest_webhook_inbox: {
    insert: 'inbox_insert',
    insertKey: 'event_id',
    read: 'inbox_read',
    readKeys: ['event_id'],
  },
  piggyvest_event_quarantine: {
    insert: 'quarantine_insert',
    insertKey: 'body_digest',
  },
  // PVB credit identity is pvb_reference (PiggyVest, 2026-11-11); the
  // internal provider id stays readable for pre-migration legacy rows.
  piggyvest_inflow_credits: {
    insert: 'inflow_credit_insert',
    insertKey: 'pvb_reference',
    read: 'inflow_credit_read',
    readKeys: ['pvb_reference', 'provider_transaction_id'],
  },
  piggyvest_interest_payouts: {
    insert: 'interest_payout_insert',
    insertKey: 'pvb_reference',
    read: 'interest_payout_read',
    readKeys: ['pvb_reference', 'provider_payout_id'],
  },
  piggyvest_plan_wallets: { read: 'plan_wallet_read', readKeys: ['wallet_id'] },
};

function columns(selected: string | undefined): string[] {
  return (selected ?? '')
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
}

function project(row: unknown, wanted: string[]): unknown {
  if (typeof row !== 'object' || row === null || wanted.length === 0)
    return row;
  return Object.fromEntries(
    wanted.filter((c) => c in row).map((c) => [c, (row as Row)[c]])
  );
}

function projectRows(rows: unknown, wanted: string[]): unknown {
  return Array.isArray(rows) ? rows.map((row) => project(row, wanted)) : rows;
}

function failure(error: unknown): Result {
  if (error instanceof PiggyvestIntakeDbError && error.code)
    return {
      data: null,
      error: {
        code: error.code,
        message: 'PiggyVest intake database unavailable',
      },
    };
  return {
    data: null,
    error: {
      code: 'PGRST_UNAVAILABLE',
      message: 'PiggyVest intake database unavailable',
    },
  };
}

class IntakeQuery implements PromiseLike<Result> {
  private op: 'select' | 'upsert' | 'update' | 'delete' | undefined;
  private values: Row = {};
  private filters: Pair[] = [];
  private selected: string | undefined;
  private single = false;

  constructor(
    private readonly table: string,
    private readonly execute: PiggyvestWebhookIntakeExecute
  ) {}

  select(selected?: string) {
    this.op ??= 'select';
    this.selected = selected;
    return this;
  }
  upsert(values: Row) {
    this.op = 'upsert';
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    this.values = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional thenable that mirrors the awaited query-builder surface the receiver's modules use
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }

  private plan(): {
    fn: PiggyvestWebhookIntakeFunction;
    payload: Row;
    wanted: string[];
    many: boolean;
  } | null {
    const wanted = columns(this.selected);
    const route = tables[this.table];
    const only = (...names: string[]) =>
      this.filters.length === names.length &&
      names.every((name, i) => this.filters[i]?.[0] === name);
    if (this.op === 'upsert' && route?.insert && route.insertKey) {
      const exactKey = wanted.length === 1 && wanted[0] === route.insertKey;
      if (!exactKey || this.filters.length > 0) return null;
      return { fn: route.insert, payload: this.values, wanted, many: true };
    }
    const readKey = route?.readKeys?.find((key) => only(key));
    if (this.op === 'select' && route?.read && readKey) {
      if (!this.single) return null;
      return {
        fn: route.read,
        payload: { [readKey]: this.filters[0]?.[1] },
        wanted,
        many: false,
      };
    }
    if (
      this.op === 'update' &&
      this.table === 'piggyvest_plan_wallets' &&
      only('wallet_id') &&
      wanted.join() === 'wallet_id'
    )
      return {
        fn: 'plan_wallet_set_status',
        payload: {
          wallet_id: this.filters[0]?.[1],
          status: this.values.status,
        },
        wanted,
        many: true,
      };
    if (
      this.op === 'update' &&
      this.table === 'piggyvest_transfer_outbox' &&
      only('reference', 'status') &&
      this.filters[1]?.[1] === 'submitted' &&
      wanted.join() === 'reference'
    )
      return {
        fn: 'outbox_apply_terminal',
        payload: {
          reference: this.filters[0]?.[1],
          status: this.values.status,
        },
        wanted,
        many: true,
      };
    return null;
  }

  private async run(): Promise<Result> {
    const plan = this.plan();
    if (!plan) return unsupported;
    try {
      const data = await this.execute(plan.fn, plan.payload);
      return {
        data: plan.many
          ? projectRows(data, plan.wanted)
          : project(data, plan.wanted),
        error: null,
      };
    } catch (error) {
      return failure(error);
    }
  }
}

export function createPiggyvestIntakeClientFromExecutor(
  execute: PiggyvestWebhookIntakeExecute & { close?: () => Promise<void> }
): PiggyvestIntakeClient {
  const facade = {
    dispose: async (): Promise<void> => {
      await execute.close?.();
    },
    from: (table: string) => new IntakeQuery(table, execute),
    async rpc(name: string, args: Row = {}): Promise<Result> {
      const route = Object.hasOwn(rpcRoutes, name) ? rpcRoutes[name] : null;
      const payload = route?.payload(args) ?? null;
      if (!route || !payload) return unsupported;
      try {
        return { data: await execute(route.fn, payload), error: null };
      } catch (error) {
        return failure(error);
      }
    },
  };
  // The one cast of the design: the facade implements the allowlisted subset
  // of the client surface the receiver's modules use, and nothing else.
  return facade as unknown as PiggyvestIntakeClient;
}
