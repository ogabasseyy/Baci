import { CustomerSavingsEarningsResponseSchema } from '../schemas/customer-savings-earnings';

export type CustomerSavingsEarningsRpcClient = {
  rpc: (
    functionName: 'get_customer_savings_earnings',
    args: { p_merchant_id: string }
  ) => Promise<{ data: unknown; error: unknown }>;
};

export async function fetchCustomerSavingsEarningsKobo({
  client,
  merchantId,
}: {
  client: CustomerSavingsEarningsRpcClient;
  merchantId: string;
}): Promise<number | null> {
  try {
    const { data, error } = await client.rpc('get_customer_savings_earnings', {
      p_merchant_id: merchantId,
    });
    if (error) return null;

    const parsed = CustomerSavingsEarningsResponseSchema.safeParse(data);
    return parsed.success ? parsed.data.credited_interest_kobo : null;
  } catch {
    return null;
  }
}
