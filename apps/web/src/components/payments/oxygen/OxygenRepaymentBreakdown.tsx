import type { OxygenCheckoutQuote } from '@/lib/payments/oxygen/checkout';

export function oxygenCheckoutMoney(minor: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(minor / 100);
}
function MoneyRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 py-2 ${strong ? 'border-t font-semibold' : ''}`}
    >
      <dt>{label}</dt>
      <dd className="whitespace-nowrap tabular-nums">
        {oxygenCheckoutMoney(value)}
      </dd>
    </div>
  );
}
export function OxygenRepaymentBreakdown({
  quote,
}: {
  quote: OxygenCheckoutQuote;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <fieldset
        aria-label="Payment breakdown"
        className="rounded-xl border border-gray-200 bg-white p-5"
      >
        <h2 className="mb-3 text-lg font-semibold">Pay upfront</h2>
        <dl className="text-sm text-gray-700">
          <MoneyRow label="Product price" value={quote.productMinor} />
          <MoneyRow
            label={`Down payment (${quote.equityPercentage}%)`}
            value={quote.equityMinor}
          />
          <MoneyRow label="Upfront charges" value={quote.chargesMinor} />
          <MoneyRow label="Upfront payment" value={quote.upfrontMinor} strong />
        </dl>
        <details className="mt-3 text-sm text-gray-600">
          <summary className="cursor-pointer py-2">Charge breakdown</summary>
          <dl>
            <MoneyRow label="Management fee" value={quote.managementMinor} />
            <MoneyRow
              label="Credit life insurance"
              value={quote.insuranceMinor}
            />
            <MoneyRow label="VAT" value={quote.vatMinor} />
          </dl>
        </details>
      </fieldset>
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-semibold">
          Repay over {quote.tenureMonths} months
        </h2>
        <dl className="text-sm text-gray-700">
          <MoneyRow label="Amount financed" value={quote.principalMinor} />
          <MoneyRow
            label="Interest over the term"
            value={quote.interestMinor}
          />
          {quote.instalmentsMinor
            .map((amount, index) => ({ amount, period: index + 1 }))
            .map(({ amount, period }) => (
              <MoneyRow
                key={period}
                label={`Instalment ${period}`}
                value={amount}
              />
            ))}
          <MoneyRow
            label="Total instalment repayments"
            value={quote.totalRepaymentMinor}
            strong
          />
        </dl>
      </div>
      <dl className="rounded-xl border border-gray-200 bg-white px-5 py-3 text-sm md:col-span-2">
        <MoneyRow
          label="Total payable (upfront + instalments)"
          value={quote.upfrontMinor + quote.totalRepaymentMinor}
        />
      </dl>
    </div>
  );
}
