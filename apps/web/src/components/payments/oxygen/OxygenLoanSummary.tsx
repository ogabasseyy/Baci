import {
  fromOxygenMinorUnits,
  toOxygenMinorUnits,
} from '@/lib/payments/oxygen/money';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';

const money = (amount: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(
    amount
  );
const date = (value: [number, number, number]) =>
  new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(value[0], value[1] - 1, value[2])));

export function OxygenLoanSummary({ state }: { state: OxygenProviderState }) {
  const booking = state.booking;
  if (!booking) return null;
  const charges = booking.total_charges ?? state.quotedCharges;
  const upfront =
    booking.total_upfront_payment ??
    (charges == null
      ? undefined
      : Number(
          fromOxygenMinorUnits(
            toOxygenMinorUnits(booking.equity_amount, 'NGN') +
              toOxygenMinorUnits(charges, 'NGN'),
            'NGN'
          )
        ));
  const rows = [
    ['Product total', money(booking.product_amount)],
    ['Your down payment', money(booking.equity_amount)],
    ['Amount financed', money(booking.loan_amount)],
    [
      'Upfront charges',
      charges == null ? 'Awaiting confirmation' : money(charges),
    ],
    ...(upfront != null ? [['Total due upfront', money(upfront)]] : []),
  ];
  return (
    <section
      aria-label="Loan breakdown"
      className="rounded-2xl border border-gray-100 bg-gray-50 p-5"
    >
      <h3 className="mb-4 text-base font-bold text-gray-900">
        Your payment plan
      </h3>
      <dl className="grid gap-3 text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-wrap justify-between gap-x-4 gap-y-1"
          >
            <dt className="text-gray-500">{label}</dt>
            <dd className="font-semibold text-gray-900">{value}</dd>
          </div>
        ))}
      </dl>
      {state.schedule ? (
        <details open className="mt-4 border-t border-gray-200 pt-4">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-gray-700">
            Repayment schedule
          </summary>
          <ol className="grid gap-3 pt-2">
            {state.schedule.map((row) => (
              <li
                key={row.period}
                className="flex justify-between gap-4 text-sm"
              >
                <span className="text-gray-500">{date(row.dueDate)}</span>
                <span className="font-semibold text-gray-900">
                  {money(row.amount)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : (
        <p role="status" className="mt-4 text-xs text-gray-500">
          Preparing your repayment schedule…
        </p>
      )}
    </section>
  );
}
