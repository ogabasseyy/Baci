import type { SupabaseClient } from '@supabase/supabase-js';

type Json =
  | boolean
  | null
  | number
  | string
  | Json[]
  | { [key: string]: Json | undefined };

type TableDefinition<
  Row extends object,
  Insert extends object = Partial<Row>,
  Update extends object = Partial<Row>,
> = {
  Row: Row & Record<string, unknown>;
  Insert: Insert & Record<string, unknown>;
  Update: Update & Record<string, unknown>;
  Relationships: [];
};

type SavingsAutoDebitDatabase = {
  public: {
    Tables: {
      customer_saved_payment_methods: TableDefinition<{
        authorization_code: string;
        authorization_data: Json | null;
        bank: string | null;
        brand: string | null;
        card_type: string | null;
        exp_month: string | null;
        exp_year: string | null;
        id: string;
        is_active: boolean;
        is_default: boolean;
        last4: string | null;
        provider: 'paystack';
        provider_customer_email: string | null;
      }>;
      customer_savings_contributions: TableDefinition<
        {
          id: string;
          status: string;
        },
        {
          amount: number;
          customer_id: string;
          goal_id: string;
          idempotency_key: string;
          merchant_id: string;
          metadata: Json;
          scheduled_for: string;
          source_type: string;
          status: string;
          transaction_id: string;
        },
        {
          failed_at?: string;
          failure_reason?: string;
          status?: string;
          updated_at?: string;
        }
      >;
      customer_savings_goals: TableDefinition<
        DueSavingsGoalRow & {
          source_mode: string;
          status: string;
        }
      >;
      reconciliation_review: TableDefinition<
        {
          id: string;
        },
        {
          issue_type: string;
          metadata: Json;
          paystack_ref: string;
          reason: string;
          txn_id: string;
        }
      >;
      transactions: TableDefinition<
        {
          id: string;
        },
        {
          amount: number;
          currency: string;
          description: string;
          gateway: string;
          gateway_reference: string;
          merchant_amount: number;
          merchant_id: string;
          metadata: Json;
          order_id: string | null;
          platform_fee: number;
          status: string;
          transaction_type: string;
          updated_at: string;
        },
        {
          gateway_response?: Json;
          status?: string;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      savings_goal_ids_bound_to_primary: {
        Args: { p_goal_ids: string[] };
        Returns: string[];
      };
      allocate_customer_savings_contribution: {
        Args: {
          p_amount: number;
          p_customer_id: string;
          p_description: string;
          p_goal_id: string;
          p_idempotency_key: string;
          p_merchant_id: string;
          p_source_id: string | null;
          p_source_type: string;
        };
        Returns: Array<{
          contribution_id: string;
          goal_current_amount: number | string;
          goal_status: string;
          success: boolean;
          wallet_balance: number | string;
          wallet_transaction_id: string | null;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type SavingsAutoDebitDatabaseClient =
  SupabaseClient<SavingsAutoDebitDatabase>;

export interface DueSavingsGoalRow {
  /** Naira amount for the scheduled contribution, returned by Postgres as numeric string or number. */
  contribution_amount: number | string;
  contribution_frequency: 'daily' | 'weekly' | 'monthly';
  /** Naira amount already reserved in the goal, returned by Postgres as numeric string or number. */
  current_amount: number | string;
  customer_id: string;
  id: string;
  maturity_date: string;
  merchant_id: string;
  preferred_debit_time: string | null;
  saved_payment_method_id: string | null;
  start_date: string;
  /** Naira amount required to complete the goal, returned by Postgres as numeric string or number. */
  target_amount: number | string;
}

export interface SavedChargeMethod {
  authorization_code: string;
  provider_customer_email: string | null;
}

export interface ExistingContributionRow {
  id: string;
  status: string;
}

export interface TransactionRow {
  id: string;
}
