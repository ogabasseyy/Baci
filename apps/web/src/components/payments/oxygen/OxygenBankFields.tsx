'use client';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  oxygenAccountNameSchema,
  oxygenBankListSchema,
} from '@/schemas/oxygen-bank-details';

import { OxygenBankSelect } from './OxygenBankSelect';
import { oxygenFieldClass as field } from './oxygen-checkout-styles';

const endpoint = '/api/payments/oxygen/bank-details';
async function lookup(input: Record<string, string>) {
  const response = await fetchWithCsrf(endpoint, {
    method: 'POST',
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Bank lookup unavailable');
  return response.json() as Promise<unknown>;
}
export function OxygenBankFields({
  workflowId,
  busy,
  defaults = {},
  active = true,
}: {
  workflowId?: string;
  busy: boolean;
  active?: boolean;
  defaults?: { bank_code?: string; account_number?: string };
}) {
  const bankId = useId();
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [bank, setBank] = useState(defaults.bank_code ?? '');
  const [number, setNumber] = useState(defaults.account_number ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    if (!workflowId) return;
    setLoading(true);
    void lookup({ workflowId, action: 'banks' })
      .then((result) => {
        const parsed = oxygenBankListSchema.parse(result);
        if (alive) {
          setBanks(parsed.banks);
          setError('');
        }
      })
      .catch(() => {
        if (alive) setError('Unable to load banks. Try loading them again.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [workflowId]);
  function invalidate() {
    generation.current++;
    setName('');
    setError('');
    setResolving(false);
  }
  async function loadBanks() {
    if (!workflowId || loading) return;
    setLoading(true);
    try {
      setBanks(
        oxygenBankListSchema.parse(
          await lookup({ workflowId, action: 'banks' })
        ).banks
      );
      setError('');
    } catch {
      setError('Unable to load banks. Try loading them again.');
    } finally {
      setLoading(false);
    }
  }
  async function resolve() {
    if (!workflowId || !active || busy || !bank || !/^\d{10}$/.test(number))
      return;
    const token = ++generation.current;
    setResolving(true);
    setError('');
    setName('');
    try {
      const result = oxygenAccountNameSchema.parse(
        await lookup({
          workflowId,
          action: 'resolve',
          bank_code: bank,
          account_number: number,
        })
      );
      if (generation.current === token) setName(result.accountName);
    } catch {
      if (generation.current === token)
        setError(
          'Unable to verify this account. Check the bank and account number.'
        );
    } finally {
      if (generation.current === token) setResolving(false);
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: resolve reads only the selected account; result state must not restart the lookup.
  useEffect(() => {
    if (
      !active ||
      busy ||
      !banks.some((item) => item.code === bank) ||
      !/^\d{10}$/.test(number)
    )
      return;
    void resolve();
    return () => {
      generation.current++;
    };
  }, [bank, number, workflowId, busy, active, banks]);
  return (
    <fieldset className="grid gap-5" aria-label="Bank account verification">
      <p className="text-sm leading-relaxed text-gray-500">
        Your account name appears automatically after you enter all 10 digits.
      </p>
      <div className="grid gap-2 text-sm font-medium text-gray-700">
        <label htmlFor={bankId}>Bank</label>
        <OxygenBankSelect
          id={bankId}
          banks={banks}
          value={bank}
          disabled={busy || loading}
          loading={loading}
          onChange={(code) => {
            invalidate();
            setBank(code);
          }}
        />
      </div>
      <input
        type="hidden"
        name="bank_name"
        value={banks.find((b) => b.code === bank)?.name ?? ''}
      />
      {banks.length === 0 && !loading && (
        <button type="button" disabled={busy} onClick={() => void loadBanks()}>
          Load banks
        </button>
      )}
      <label className="grid gap-2 text-sm font-medium text-gray-700">
        Account number
        <input
          className={field}
          name="account_number"
          inputMode="numeric"
          pattern="[0-9]{10}"
          maxLength={10}
          required
          placeholder="10-digit account number"
          autoComplete="off"
          value={number}
          disabled={busy}
          onChange={(e) => {
            invalidate();
            setNumber(e.target.value.replace(/\D/g, '').slice(0, 10));
          }}
        />
      </label>
      <div
        aria-live="polite"
        className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
      >
        <label className="grid gap-1 text-xs font-medium text-gray-500">
          Account name
          <input
            className="w-full border-0 bg-transparent p-0 text-sm font-semibold text-gray-900 outline-hidden placeholder:font-normal placeholder:text-gray-400"
            name="account_name"
            value={name}
            readOnly
            placeholder={
              resolving
                ? 'Verifying account…'
                : 'Waiting for your account details'
            }
          />
        </label>
        {resolving && (
          <p
            className="mt-2 flex items-center gap-2 text-xs text-gray-500"
            role="status"
          >
            <Loader2
              aria-hidden="true"
              className="h-3.5 w-3.5 motion-safe:animate-spin"
            />
            Checking your account
          </p>
        )}
        {name && (
          <p
            className="mt-2 flex items-center gap-2 text-xs font-medium text-emerald-700"
            role="status"
          >
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
            Account verified
          </p>
        )}
      </div>
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p role="alert">{error}</p>
          {banks.length > 0 && (
            <button
              className="mt-2 font-semibold underline underline-offset-4"
              type="button"
              disabled={busy || resolving || !bank || !/^\d{10}$/.test(number)}
              onClick={() => void resolve()}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}
