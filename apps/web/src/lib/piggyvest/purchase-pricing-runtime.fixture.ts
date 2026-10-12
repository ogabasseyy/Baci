import type { SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { piggyvestPostgresConfigurationSchema } from '@/schemas/piggyvest-postgres-configuration';

export const goal = (sequence: number) =>
  `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
export const actorId = '90000000-0000-4000-8000-000000000001';
export const merchantId = '10000000-0000-4000-8000-000000000001';
export const customerId = '20000000-0000-4000-8000-000000000001';
export function database() {
  return piggyvestPostgresConfigurationSchema.parse({
    environment: 'staging',
    transport: 'local_test',
    socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    role: 'piggyvest_staging_policy_writer',
    port: 55451,
  });
}
export async function query(
  user: string,
  text: string,
  values: unknown[] = []
) {
  const config = database();
  if (config.transport !== 'local_test') throw new Error('Local only');
  const client = new Client({
    host: config.socketDirectory,
    port: config.port,
    database: config.database,
    user,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
    query_timeout: 3000,
  });
  try {
    await client.connect();
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}
export function authenticatedReader(actor = actorId): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: actor } }, error: null }),
    },
    from(table: string) {
      if (
        ![
          'merchants',
          'customers',
          'customer_savings_goals',
          'products',
        ].includes(table)
      )
        throw new Error('Unexpected table');
      let projection = '';
      const filters: string[] = [];
      const values: unknown[] = [];
      const reader = {
        select(columns: string) {
          projection = columns.includes('variants:')
            ? `id,name,price,images,condition,(SELECT jsonb_agg(jsonb_build_object('id',variant.id,'price_override',variant.price_override,'condition',variant.condition,'sku',variant.sku,'images',variant.images,'attributes',variant.attributes,'is_inventory_anchor',variant.is_inventory_anchor)) FROM public.product_variants variant WHERE variant.product_id=products.id) AS variants`
            : columns;
          return reader;
        },
        eq(column: string, value: unknown) {
          if (
            !['id', 'merchant_id', 'customer_id', 'user_id', 'status'].includes(
              column
            )
          )
            throw new Error('Unexpected filter');
          values.push(value);
          filters.push(`${column}=$${values.length}`);
          return reader;
        },
        async maybeSingle() {
          const response = await query(
            'purchase_pricing_customer',
            `SELECT ${projection} FROM public.${table} WHERE ${filters.join(' AND ')}`,
            values
          );
          return {
            data: response.rows.length === 1 ? response.rows[0] : null,
            error: null,
          };
        },
      };
      return reader;
    },
    async rpc(fn: string, params: Record<string, unknown>) {
      if (fn !== 'get_storefront_product_variants')
        throw new Error('Unexpected RPC');
      const response = await query(
        'purchase_pricing_customer',
        'SELECT * FROM public.get_storefront_product_variants($1)',
        [params.p_product_ids]
      );
      return { data: response.rows, error: null };
    },
  } as unknown as SupabaseClient;
}
export function configuration() {
  return {
    environment: 'staging',
    transport: 'local_test',
    integrationId: '40000000-0000-4000-8000-000000000001',
    merchantId,
    expectedBusinessId: 'synthetic-business',
    allowlistedMerchantIds: [merchantId],
    allowlistedCustomerIds: [customerId],
    expectedProjectId: 'synthetic',
    actualProjectId: 'synthetic',
  };
}
