import {
  type OxygenProviderContext,
  type OxygenProviderState,
  type OxygenRuntimeAction,
  oxygenBookingSchema,
} from '@/schemas/oxygen-runtime';
import { toOxygenMinorUnits } from './money';
import type { OxygenProvider } from './provider';
import { requireValue } from './runtime-policy';
export async function bookOxygenPlan(
  c: OxygenProviderContext,
  s: OxygenProviderState,
  a: Extract<OxygenRuntimeAction, { action: 'book' }>,
  p: OxygenProvider
): Promise<void> {
  const amount = toOxygenMinorUnits(c.productAmount, 'NGN');
  const equity = Number(
    (BigInt(amount) * BigInt(Math.round(a.equityPercentage * 100)) + 5000n) /
      10000n
  );
  const principal = amount - equity;
  if (
    principal < toOxygenMinorUnits(requireValue(s.minimumAmount), 'NGN') ||
    principal > toOxygenMinorUnits(requireValue(s.eligibleAmount), 'NGN') ||
    a.tenure > requireValue(s.maxTenure) ||
    !c.address.trim()
  )
    throw new Error('Plan exceeds eligible terms or checkout address missing');
  const result = oxygenBookingSchema.parse(
    await p.call('book', {
      loan_request_reference: requireValue(s.applicationReference),
      partner_reference: c.partnerReference,
      ...(c.merchantReference
        ? { merchant_reference: c.merchantReference }
        : {}),
      phone_number: requireValue(s.phone),
      product_amount: c.productAmount,
      equity_percentage: a.equityPercentage,
      loan_tenure: a.tenure,
      product_information: { name: c.productName, model: c.productName },
      address: c.address,
    })
  );
  if (
    result.status !== 'BOOKED' ||
    toOxygenMinorUnits(result.product_amount, 'NGN') !== amount ||
    toOxygenMinorUnits(result.loan_amount, 'NGN') !== principal ||
    toOxygenMinorUnits(result.equity_amount, 'NGN') !== equity ||
    result.equity_percentage !== a.equityPercentage ||
    result.loan_tenure !== a.tenure
  )
    throw new Error('Booking terms mismatch');
  s.bookingReference = result.loan_reference;
  s.booking = result;
  delete s.activityToken;
  delete s.schedule;
  delete s.quotedCharges;
  delete s.paymentUrl;
  delete s.setupUrl;
  delete s.paymentComplete;
  delete s.setupComplete;
}
