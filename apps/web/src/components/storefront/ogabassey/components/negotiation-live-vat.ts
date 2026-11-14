import { z } from 'zod';
import type { createClient } from '@/lib/supabase/client';

const resultSchema = z
  .array(
    z.object({
      resolution_status: z.literal('found'),
      merchant_data: z.object({
        id: z.string(),
        vat_registration_status: z.enum([
          'not_registered',
          'registered',
          'exempt',
          'pending',
        ]),
        vat_rate: z.number().finite().min(0).max(100).nullable(),
      }),
    })
  )
  .length(1);

export async function readNegotiationVatRate(
  client: ReturnType<typeof createClient>,
  slug: string,
  merchantId: string,
  signal: AbortSignal
): Promise<number> {
  if (!slug || !merchantId) throw new Error('Merchant unavailable');
  const { data, error } = await client
    .rpc('resolve_storefront_public_snapshot_v2', {
      p_identifier: slug,
    })
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(10_000)]));
  const result = resultSchema.safeParse(data);
  if (error || !result.success) throw new Error('Merchant VAT unavailable');
  const merchant = result.data[0].merchant_data;
  if (merchant.id !== merchantId) throw new Error('Merchant mismatch');
  if (merchant.vat_registration_status !== 'registered') return 0;
  if (merchant.vat_rate === null) throw new Error('Merchant VAT unavailable');
  return merchant.vat_rate / 100;
}
