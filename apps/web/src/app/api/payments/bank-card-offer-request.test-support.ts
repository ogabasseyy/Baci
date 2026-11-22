import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

export const merchantSlug = 'ogabassey';

export function request(
  path: string,
  payload: Record<string, unknown>,
  sign = false
) {
  const body = JSON.stringify(
    path === 'verify' ? { merchantSlug: merchantSlug, ...payload } : payload
  );
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (sign)
    headers['x-paystack-signature'] = createHmac(
      'sha512',
      process.env.PAYSTACK_SECRET_KEY ?? ''
    )
      .update(body)
      .digest('hex');
  return new NextRequest(`http://localhost/api/payments/${path}`, {
    method: 'POST',
    body,
    headers,
  });
}
