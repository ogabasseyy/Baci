'use client';

import { CircleDollarSign, Copy, Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import {
  type UsdtFundingState,
  useUsdtWalletFundingPolling,
} from './use-usdt-wallet-funding-polling';
import { usdtWalletFundingApi } from './usdt-wallet-funding-api';

export function UsdtWalletFundingPanel({
  balance,
  customerName,
  customerPhone,
  initialAmount,
  initialReference,
  merchantSlug,
  onFunded,
}: {
  balance: number;
  customerName?: string;
  customerPhone?: string;
  initialAmount?: number;
  initialReference?: string;
  merchantSlug: string;
  onFunded: () => void;
}) {
  const fieldIdPrefix = useId();
  const [amount, setAmount] = useState(
    initialAmount && initialAmount > 0 ? String(initialAmount) : ''
  );
  const [chain, setChain] = useState<'AVAXC' | 'ETH' | 'MATIC' | 'TRX'>('TRX');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('NG');
  const [error, setError] = useState<string | null>(null);
  const [funding, setFunding] = useState<UsdtFundingState | null>(
    initialReference
      ? { address: null, reference: initialReference, status: 'pending' }
      : null
  );
  const [line1, setLine1] = useState('');
  const [pending, setPending] = useState(false);
  const [state, setState] = useState('');
  const [zipCode, setZipCode] = useState('');

  const { checking, pollingExhausted, restartPolling } =
    useUsdtWalletFundingPolling({
      funding,
      merchantSlug,
      onAmountChange: setAmount,
      onChainChange: setChain,
      onFunded,
      onFundingChange: setFunding,
    });

  const submit = async () => {
    const numericAmount = Number(amount);
    if (
      !Number.isFinite(numericAmount) ||
      numericAmount < 1 ||
      !line1.trim() ||
      !city.trim() ||
      !zipCode.trim() ||
      !/^[A-Za-z]{2}$/.test(country)
    ) {
      setError('Enter an amount and complete the billing address.');
      return;
    }
    setError(null);
    setPending(true);
    const result = await usdtWalletFundingApi.initialize({
      amount: numericAmount,
      billingAddress: {
        city,
        country,
        line1,
        state: state || undefined,
        zipCode,
      },
      chain,
      customerName,
      customerPhone,
      merchantSlug,
    });
    setPending(false);
    if (result.kind === 'error') {
      setError(result.error);
      return;
    }
    setAmount(String(result.amount));
    setFunding({
      address: result.depositAddress,
      reference: result.reference,
      status: 'pending',
    });
  };

  return (
    <section className="rounded-2xl border border-[var(--store-border,#e5e7eb)] bg-[var(--store-surface,#fff)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--store-primary,#dc2626)]">
            USD-stable wallet
          </p>
          <h2 className="mt-1 flex items-center gap-2 font-bold text-[var(--store-text,#111827)]">
            <CircleDollarSign aria-hidden="true" size={20} /> Fund with USDT
          </h2>
        </div>
        <p className="text-lg font-black text-[var(--store-text,#111827)]">
          {balance.toFixed(2)} USDT
        </p>
      </div>

      {funding ? (
        <div className="mt-4 rounded-xl bg-[var(--store-muted,#f9fafb)] p-4">
          <p className="text-sm font-bold text-[var(--store-text,#111827)]">
            Send exactly {Number(amount).toFixed(2)} USDT on {chain}
          </p>
          {funding.address ? (
            <div className="mt-3 flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-[var(--store-surface,#fff)] p-3 text-xs text-[var(--store-text,#111827)]">
                {funding.address}
              </code>
              <button
                aria-label="Copy deposit address"
                className="rounded-lg border border-[var(--store-border,#e5e7eb)] p-3"
                onClick={() =>
                  void navigator.clipboard?.writeText(funding.address ?? '')
                }
                type="button"
              >
                <Copy aria-hidden="true" size={16} />
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--store-muted-text,#6b7280)]">
              Your deposit address is being prepared.
            </p>
          )}
          <p
            aria-live="polite"
            className="mt-2 text-xs text-[var(--store-muted-text,#6b7280)]"
          >
            Status: {funding.status}. The balance updates after network
            confirmation.
          </p>
          {pollingExhausted && funding.status === 'pending' ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--store-border,#e5e7eb)] bg-[var(--store-surface,#fff)] px-3 py-2 text-xs">
              <span className="text-[var(--store-muted-text,#6b7280)]">
                Auto-refresh paused after {60} checks.
              </span>
              <button
                className="font-semibold text-[var(--store-primary,#dc2626)] underline disabled:opacity-60"
                disabled={checking}
                onClick={restartPolling}
                type="button"
              >
                {checking ? 'Checking…' : 'Check status'}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field htmlFor={`${fieldIdPrefix}-amount`} label="Amount (USDT)">
            <input
              className="input"
              id={`${fieldIdPrefix}-amount`}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              value={amount}
            />
          </Field>
          <Field htmlFor={`${fieldIdPrefix}-network`} label="Network">
            <select
              className="input"
              id={`${fieldIdPrefix}-network`}
              onChange={(event) => setChain(event.target.value as typeof chain)}
              value={chain}
            >
              <option value="TRX">TRON (TRX)</option>
              <option value="ETH">Ethereum (ETH)</option>
              <option value="MATIC">Polygon (MATIC)</option>
              <option value="AVAXC">Avalanche C-Chain</option>
            </select>
          </Field>
          <Field htmlFor={`${fieldIdPrefix}-address-line`} label="Address line">
            <input
              className="input"
              id={`${fieldIdPrefix}-address-line`}
              onChange={(event) => setLine1(event.target.value)}
              value={line1}
            />
          </Field>
          <Field htmlFor={`${fieldIdPrefix}-city`} label="City">
            <input
              className="input"
              id={`${fieldIdPrefix}-city`}
              onChange={(event) => setCity(event.target.value)}
              value={city}
            />
          </Field>
          <Field htmlFor={`${fieldIdPrefix}-state`} label="State">
            <input
              className="input"
              id={`${fieldIdPrefix}-state`}
              onChange={(event) => setState(event.target.value)}
              value={state}
            />
          </Field>
          <Field htmlFor={`${fieldIdPrefix}-postal-code`} label="Postal code">
            <input
              className="input"
              id={`${fieldIdPrefix}-postal-code`}
              onChange={(event) => setZipCode(event.target.value)}
              value={zipCode}
            />
          </Field>
          <Field htmlFor={`${fieldIdPrefix}-country-code`} label="Country code">
            <input
              className="input uppercase"
              id={`${fieldIdPrefix}-country-code`}
              maxLength={2}
              onChange={(event) => setCountry(event.target.value.toUpperCase())}
              value={country}
            />
          </Field>
          <div className="flex items-end">
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--store-primary,#dc2626)] px-4 py-3 font-bold text-white disabled:opacity-60"
              disabled={pending}
              onClick={() => void submit()}
              type="button"
            >
              {pending ? (
                <Loader2
                  aria-hidden="true"
                  className="animate-spin"
                  size={17}
                />
              ) : null}
              Create deposit address
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p
          className="mt-3 text-sm text-[var(--store-danger-text,#b91c1c)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <label
      className="grid gap-1 text-sm font-semibold text-[var(--store-text,#111827)]"
      htmlFor={htmlFor}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
