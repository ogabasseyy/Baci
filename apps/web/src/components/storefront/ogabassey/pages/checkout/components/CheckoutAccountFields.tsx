'use client';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import {
  type CheckoutAccountValues,
  CONTACT_FIELD_IDS,
} from '../contact-validation';

export function CheckoutAccountFields({
  account,
  onChange,
  error,
}: {
  account: CheckoutAccountValues;
  onChange: (value: CheckoutAccountValues) => void;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  const passwordId = CONTACT_FIELD_IDS.accountPassword;
  return (
    <div className="md:col-span-2 space-y-4 pt-4">
      <div
        className={`bg-gray-50 rounded-xl p-4 border transition-all duration-300 ${account.createAccount ? 'border-store-primary/30 bg-store-primary/5' : 'border-gray-100 hover:border-store-primary/20'}`}
      >
        <label className="flex items-start gap-3 cursor-pointer group mb-2">
          <input
            type="checkbox"
            checked={account.createAccount}
            onChange={(event) =>
              onChange({ ...account, createAccount: event.target.checked })
            }
            className="mt-0.5 size-5 rounded border-gray-300 text-store-primary focus:ring-store-primary"
          />
          <span>
            <span className="block text-sm font-bold text-gray-900 group-hover:text-store-primary transition-colors">
              Save my information for a faster checkout next time
            </span>
            <span className="text-xs text-gray-500 mt-0.5 block">
              Securely save your address details for future orders.
            </span>
          </span>
        </label>
        <div hidden={!account.createAccount} inert={!account.createAccount}>
          <div className="mt-3 pl-8">
            <label
              htmlFor={passwordId}
              className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5"
            >
              Create a Password
            </label>
            <div className="relative">
              <input
                id={passwordId}
                name="accountPassword"
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                value={account.password}
                onChange={(event) =>
                  onChange({ ...account, password: event.target.value })
                }
                placeholder="Min. 6 characters"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${passwordId}-error` : undefined}
                className={`w-full px-4 py-3 bg-white border rounded-xl focus:outline-hidden text-sm text-gray-900 placeholder:text-gray-400 pr-12 ${error ? 'border-red-500 focus:border-red-500' : 'border-gray-200 focus:border-store-primary'}`}
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-label={visible ? 'Hide password' : 'Show password'}
                aria-pressed={visible}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {visible ? (
                  <EyeOff aria-hidden="true" size={18} />
                ) : (
                  <Eye aria-hidden="true" size={18} />
                )}
              </button>
            </div>
            {error && (
              <p
                id={`${passwordId}-error`}
                className="text-red-500 text-xs mt-1"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
