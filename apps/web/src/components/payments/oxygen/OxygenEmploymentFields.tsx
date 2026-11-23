'use client';
import { useId, useState } from 'react';
import type { OxygenFormDraft } from '@/schemas/oxygen-form-draft';
import { OxygenChatQuestion, oxygenIncomeTurns } from './OxygenChatQuestion';
import { OxygenSelect } from './OxygenSelect';
import { oxygenFieldClass as field } from './oxygen-checkout-styles';
import { isOxygenEmploymentReady } from './oxygen-employment-ready';

function ordinal(day: number) {
  if (day >= 11 && day <= 13) return `${day}th`;
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
}
function formatIncome(value: string) {
  const [whole, fraction] = value.split('.');
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
    (fraction === undefined ? '' : `.${fraction}`)
  );
}
export function OxygenEmploymentFields({
  defaults,
  onReady,
  conversationTurn,
}: {
  onReady?: () => void;
  conversationTurn?: number;
  defaults: OxygenFormDraft['fields'];
}) {
  const id = useId();
  const [income, setIncome] = useState(
    (defaults.salary_amount ?? '').replaceAll(',', '')
  );
  const [payday, setPayday] = useState(defaults.salary_date ?? '');
  function revealWhenComplete(amount: string, day: string) {
    if (isOxygenEmploymentReady(amount, day)) onReady?.();
  }
  return (
    <div
      className={
        conversationTurn === undefined ? 'grid gap-4 sm:grid-cols-2' : undefined
      }
    >
      <OxygenChatQuestion
        current={conversationTurn}
        turn={oxygenIncomeTurns.employment}
        prompt="How do you currently earn a living?"
      >
        <label
          htmlFor={`${id}-employment`}
          className="grid gap-1.5 text-xs font-bold text-gray-700"
        >
          Employment status
          <OxygenSelect
            id={`${id}-employment`}
            name="employment_status"
            defaultValue={
              defaults.employment_status ??
              (conversationTurn === undefined ? undefined : '')
            }
            required={conversationTurn !== undefined}
          >
            {conversationTurn !== undefined && (
              <option disabled value="">
                Choose your employment status
              </option>
            )}
            <option value="EMPLOYED">Employed</option>
            <option value="SELF_EMPLOYED">Self-employed</option>
            <option value="PENSIONER">Pensioner</option>
            <option value="UNEMPLOYED">Unemployed</option>
          </OxygenSelect>
        </label>
      </OxygenChatQuestion>
      <OxygenChatQuestion
        current={conversationTurn}
        turn={oxygenIncomeTurns.employer}
        prompt="Who do you work for? You can skip this if it doesn’t apply."
      >
        <label className="grid gap-1.5 text-xs font-bold text-gray-700">
          Employer
          <input
            className={field}
            name="name_of_employer"
            defaultValue={defaults.name_of_employer}
            maxLength={100}
          />
        </label>
      </OxygenChatQuestion>
      <OxygenChatQuestion
        current={conversationTurn}
        turn={oxygenIncomeTurns.amount}
        prompt="How much do you earn each month? Enter the amount privately below."
      >
        <label className="grid gap-1.5 text-xs font-bold text-gray-700">
          Monthly income (₦)
          <input
            className={field}
            value={formatIncome(income)}
            type="text"
            inputMode="decimal"
            maxLength={40}
            pattern={'[0-9,]+(\\.[0-9]{1,2})?'}
            title="Enter an amount with up to two decimal places."
            placeholder="e.g. 250,000"
            required
            onChange={(event) => {
              const value = event.target.value.replaceAll(',', '');
              if (/^\d*(\.\d{0,2})?$/.test(value) && value.length <= 30) {
                const next = value.startsWith('.') ? `0${value}` : value;
                setIncome(next);
                revealWhenComplete(next, payday);
              }
            }}
          />
        </label>
        <input type="hidden" name="salary_amount" value={income} />
      </OxygenChatQuestion>
      <OxygenChatQuestion
        current={conversationTurn}
        turn={oxygenIncomeTurns.payday}
        prompt="What day of the month do you usually get paid?"
      >
        <label
          htmlFor={`${id}-payday`}
          className="grid gap-1.5 text-xs font-bold text-gray-700"
        >
          When are you paid?
          <OxygenSelect
            id={`${id}-payday`}
            name="salary_date"
            value={payday}
            onChange={(event) => {
              setPayday(event.target.value);
              revealWhenComplete(income, event.target.value);
            }}
            required
          >
            <option value="" disabled>
              Select your monthly payday
            </option>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                {ordinal(day)} of every month
              </option>
            ))}
          </OxygenSelect>
        </label>
      </OxygenChatQuestion>
    </div>
  );
}
