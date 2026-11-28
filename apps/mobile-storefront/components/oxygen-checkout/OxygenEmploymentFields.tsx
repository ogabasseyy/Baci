import { useState } from 'react';
import { View } from 'react-native';
import { OxygenEmploymentSummary } from './OxygenEmploymentSummary';
import { OxygenField } from './OxygenFormPrimitives';
import { OxygenFormSelect } from './OxygenFormSelect';
import type { OxygenHomeAddressProps } from './OxygenHomeAddress';

const employment = [
  { value: 'EMPLOYED', label: 'Employed' },
  { value: 'SELF_EMPLOYED', label: 'Self-employed' },
  { value: 'PENSIONER', label: 'Pensioner' },
  { value: 'UNEMPLOYED', label: 'Unemployed' },
];
function ordinal(day: number) {
  if (day >= 11 && day <= 13) return `${day}th`;
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
}
const paydays = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: `${ordinal(index + 1)} of every month`,
}));

export function OxygenEmploymentFields({
  fields,
  onChange,
  busy,
  errors,
}: OxygenHomeAddressProps) {
  const complete = Boolean(
    employment.some((item) => item.value === fields.employment_status) &&
      /^\d+(\.\d{1,2})?$/.test(fields.salary_amount ?? '') &&
      paydays.some((item) => item.value === fields.salary_date)
  );
  const [collapsed, setCollapsed] = useState(complete);
  const invalid = [
    'employment_status',
    'name_of_employer',
    'salary_amount',
    'salary_date',
  ].some((key) => errors?.[key as keyof typeof fields]);
  const [whole, fraction] = (fields.salary_amount ?? '')
    .replaceAll(',', '')
    .split('.');
  const income =
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
    (fraction === undefined ? '' : `.${fraction}`);
  if (collapsed && complete && !invalid)
    return (
      <OxygenEmploymentSummary
        status={
          employment.find((item) => item.value === fields.employment_status)
            ?.label ?? ''
        }
        employer={fields.name_of_employer}
        income={income}
        payday={
          paydays.find((item) => item.value === fields.salary_date)?.label ?? ''
        }
        busy={busy}
        onEdit={() => setCollapsed(false)}
      />
    );
  return (
    <View>
      <OxygenFormSelect
        label="Employment status"
        value={fields.employment_status}
        options={employment}
        placeholder="Select employment status"
        disabled={busy}
        onChange={(employment_status) => onChange({ employment_status })}
        error={errors?.employment_status}
      />
      <OxygenField
        label="Employer"
        value={fields.name_of_employer}
        onChange={(name_of_employer) => onChange({ name_of_employer })}
        editable={!busy}
        maxLength={100}
        error={errors?.name_of_employer}
      />
      <OxygenField
        label="Monthly income (₦)"
        value={income}
        keyboardType="decimal-pad"
        onChange={(input) => {
          const next = input.replaceAll(',', '');
          if (/^\d*(\.\d{0,2})?$/.test(next) && next.length <= 30)
            onChange({
              salary_amount: next.startsWith('.') ? `0${next}` : next,
            });
        }}
        editable={!busy}
        error={errors?.salary_amount}
      />
      <OxygenFormSelect
        label="When are you paid?"
        value={fields.salary_date}
        options={paydays}
        placeholder="Select your monthly payday"
        disabled={busy}
        onChange={(salary_date) => {
          onChange({ salary_date });
          if (
            employment.some(
              (item) => item.value === fields.employment_status
            ) &&
            /^\d+(\.\d{1,2})?$/.test(fields.salary_amount ?? '') &&
            !invalid
          )
            setCollapsed(true);
        }}
        error={errors?.salary_date}
      />
    </View>
  );
}
