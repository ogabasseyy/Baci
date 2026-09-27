import { PhoneInput } from '@/components/ui/phone-input';
import {
  CONTACT_FIELD_IDS,
  type ContactErrors,
  type ContactValues,
} from '../contact-validation';

const fields = [
  {
    key: 'firstName',
    label: 'First Name',
    placeholder: 'John',
    autoComplete: 'given-name',
    type: 'text',
  },
  {
    key: 'lastName',
    label: 'Last Name',
    placeholder: 'Doe',
    autoComplete: 'family-name',
    type: 'text',
  },
  {
    key: 'customerEmail',
    label: 'Email Address',
    placeholder: 'john@example.com',
    autoComplete: 'email',
    type: 'email',
  },
] as const;
const labelClass =
  'block text-xs font-bold text-gray-700 uppercase tracking-wide mb-1.5';

export function ContactFields({
  values,
  errors,
  onChange,
}: {
  values: ContactValues;
  errors: ContactErrors;
  onChange: (key: keyof ContactValues, value: string) => void;
}) {
  const phoneId = CONTACT_FIELD_IDS.customerPhone;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map(({ key, label, placeholder, autoComplete, type }) => {
          const id = CONTACT_FIELD_IDS[key];
          const error = errors[key];
          return (
            <div
              key={key}
              className={key === 'customerEmail' ? 'md:col-span-2' : undefined}
            >
              <label htmlFor={id} className={labelClass}>
                {label} *
              </label>
              <input
                id={id}
                name={key}
                type={type}
                value={values[key]}
                autoComplete={autoComplete}
                onChange={(event) => onChange(key, event.target.value)}
                placeholder={placeholder}
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:outline-hidden text-sm text-gray-900 placeholder:text-gray-400 ${error ? 'border-red-500 focus:border-red-500 bg-store-primary/5' : values[key].trim() ? 'border-store-primary/40 focus:border-store-primary focus:ring-1 focus:ring-store-primary/20' : 'border-gray-200 focus:border-store-primary focus:ring-1 focus:ring-store-primary/20'}`}
              />
              {error && (
                <p id={`${id}-error`} className="text-red-500 text-xs mt-1">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <label htmlFor={phoneId} className={labelClass}>
          Phone Number *
        </label>
        <div
          className={
            errors.customerPhone
              ? 'rounded-lg border border-red-500'
              : undefined
          }
        >
          <PhoneInput
            id={phoneId}
            name="customerPhone"
            value={values.customerPhone}
            autoComplete="tel"
            required
            onChange={(value) => onChange('customerPhone', value || '')}
            placeholder="+234 800 000 0000"
            defaultCountry="NG"
            aria-invalid={Boolean(errors.customerPhone)}
            aria-describedby={
              errors.customerPhone ? `${phoneId}-error` : undefined
            }
            className="w-full text-sm"
          />
        </div>
        {errors.customerPhone && (
          <p id={`${phoneId}-error`} className="text-red-500 text-xs mt-1">
            {errors.customerPhone}
          </p>
        )}
      </div>
    </>
  );
}
