'use client';

import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { OxygenBankLogo } from './OxygenBankLogo';
import { oxygenFieldClass } from './oxygen-checkout-styles';

type Bank = { name: string; code: string };

/** Portal stays inside the native application dialog's top layer. */
export function OxygenBankSelect({
  id,
  banks,
  value,
  disabled,
  loading,
  onChange,
}: {
  id: string;
  banks: Bank[];
  value: string;
  disabled: boolean;
  loading: boolean;
  onChange: (code: string) => void;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const selected = banks.find((bank) => bank.code === value);
  return (
    <div ref={setContainer}>
      <Select.Root
        name="bank_code"
        required
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      >
        <Select.Trigger
          id={id}
          className={`${oxygenFieldClass} flex items-center gap-3 text-left`}
        >
          <OxygenBankLogo key={value} code={selected?.code ?? ''} />
          <Select.Value
            placeholder={loading ? 'Loading banks…' : 'Select a bank'}
          >
            <span className="min-w-0 flex-1 truncate">{selected?.name}</span>
          </Select.Value>
          <Select.Icon className="ml-auto shrink-0">
            <ChevronDown className="size-4 text-gray-500" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal container={container}>
          <Select.Content
            position="popper"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 max-h-[min(320px,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width) overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 text-gray-900 shadow-xl"
          >
            <Select.Viewport className="max-h-72">
              {banks.map((bank) => (
                <Select.Item
                  key={bank.code}
                  value={bank.code}
                  textValue={bank.name}
                  className="relative flex min-h-12 cursor-pointer items-center gap-3 rounded-lg py-2 pl-3 pr-9 text-sm outline-hidden data-[highlighted]:bg-gray-50 data-[state=checked]:bg-store-primary/5"
                >
                  <OxygenBankLogo code={bank.code} />
                  <Select.ItemText>{bank.name}</Select.ItemText>
                  <Select.ItemIndicator className="absolute right-3 text-store-primary">
                    <Check className="size-4" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
