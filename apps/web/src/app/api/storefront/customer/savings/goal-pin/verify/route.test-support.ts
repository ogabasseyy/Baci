import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from './route';

export const merchantId = '11111111-1111-4111-8111-111111111111';
export const goalId = '22222222-2222-4222-8222-222222222222';
export const operationId = '33333333-3333-4333-8333-333333333333';
export const proof = createHash('sha256')
  .update('s5-route-verify')
  .digest('hex');
export const fund = {
  merchantId,
  pin: '482915',
  action: 'fund',
  goalId,
  operationId,
  amountKobo: 2000,
};
export const cancel = {
  merchantId,
  pin: '482915',
  action: 'cancel',
  goalId,
  operationId,
};
export const complete = {
  merchantId,
  pin: '482915',
  action: 'complete',
  goalId,
  operationId,
};
export function call(body: unknown) {
  return POST(
    new NextRequest(
      'https://example.com/api/storefront/customer/savings/goal-pin/verify',
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    )
  );
}
