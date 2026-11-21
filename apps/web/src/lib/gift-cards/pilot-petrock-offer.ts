import 'server-only';

import { z } from 'zod';
import { createPetrockClient } from '../imei-providers/petrock/petrock-client';
import { PILOT_PRODUCT_ID } from './pilot-wallet-config';

function toUsdCents(amount: string | number) {
  const match = /^(\d{1,6})(?:\.(\d{1,2})0*)?$/.exec(String(amount));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

const productResponse = z.object({
  data: z.object({
    currency: z.literal('USD'),
    product: z.object({
      name: z.literal('PlayStation Gift Card [PSN] USA $10'),
      price: z.union([z.number(), z.string()]).transform(toUsdCents),
      fields: z.tuple([z.object({ name: z.literal('Quantity') })]),
    }),
  }),
});

export async function readPilotPetrockOffer(
  expectedUsd: number,
  baseUrl = process.env.PETROCK_API_BASE_URL,
  token = process.env.PETROCK_API_TOKEN
) {
  const expectedCents = toUsdCents(expectedUsd);
  if (!baseUrl || !token || !expectedCents) return false;
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'https:' ||
      !/(^|\.)petrock\.biz$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    const base = url.href.replace(/\/+$/, '');
    const client = createPetrockClient({ baseUrl: base, token });
    const [product, account] = await Promise.all([
      fetch(`${base}/products?product_id=${PILOT_PRODUCT_ID}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      }),
      client.getAccount(),
    ]);
    if (!product.ok || !account.ok || account.data.currency !== 'USD')
      return false;
    const parsed = productResponse.safeParse(await product.json());
    return (
      parsed.success &&
      parsed.data.data.product.price === expectedCents &&
      account.data.balance >= expectedUsd
    );
  } catch {
    return false;
  }
}
