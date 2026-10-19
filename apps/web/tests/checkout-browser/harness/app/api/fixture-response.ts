import { NextResponse } from 'next/server';
import { order } from '../../../setup';

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function orderResponse(
  customer: Partial<
    Pick<typeof order, 'customer_name' | 'customer_email' | 'customer_phone'>
  > = {}
) {
  return {
    order: { ...order, ...customer },
    amountDueToGateway: 107500,
  };
}

export function fixtureCustomerEmail(request: Request): string | undefined {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('checkout-qa-customer-email='))
    ?.slice('checkout-qa-customer-email='.length);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function scenario(request: Request) {
  return new URL(request.url).searchParams.get('scenario') ?? 'success';
}
