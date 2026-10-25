'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { oxygenFieldClass } from './oxygen-checkout-styles';

export function OxygenIdentityField({
  name,
  label,
  defaultValue = '',
}: {
  name: 'bvn' | 'nin';
  label: 'BVN' | 'NIN';
  defaultValue?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-bold text-gray-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          defaultValue={defaultValue}
          type={visible ? 'text' : 'password'}
          className={`${oxygenFieldClass} pr-12`}
          required
          minLength={11}
          maxLength={11}
          pattern="[0-9]{11}"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-gray-500 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => setVisible(!visible)}
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
