import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import type { OxygenFormDraft } from '@/schemas/oxygen-form-draft';
import { oxygenFieldClass as field } from './oxygen-checkout-styles';
import { oxygenPersonalFields as personal } from './oxygen-customer-form-payload';
export function OxygenContactFields({
  prefill,
  defaults,
}: {
  prefill: OxygenCustomerPrefill;
  defaults: OxygenFormDraft['fields'];
}) {
  return (
    <details
      open={!prefill.first_name || !prefill.last_name || !prefill.email}
      className="mb-5"
    >
      <summary className="cursor-pointer text-xs font-medium text-gray-500 underline underline-offset-4">
        {prefill.first_name && prefill.last_name && prefill.email
          ? 'Edit name and email'
          : 'Your contact details'}
      </summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {personal
          .filter(([key]) => !['bvn', 'nin', 'date_of_birth'].includes(key))
          .map(([key, label]) => (
            <label
              key={key}
              className="grid gap-1.5 text-xs font-bold text-gray-700"
            >
              {label}
              <input
                className={field}
                name={key}
                defaultValue={
                  defaults[key] ??
                  prefill[key as keyof OxygenCustomerPrefill] ??
                  ''
                }
                type={key === 'email' ? 'email' : 'text'}
                required={key !== 'middle_name'}
                maxLength={100}
                autoComplete="off"
              />
            </label>
          ))}
      </div>
    </details>
  );
}
