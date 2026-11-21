import Ionicons from '@react-native-vector-icons/ionicons';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { OxygenBankPicker } from './OxygenBankPicker';
import {
  OxygenButton,
  OxygenField,
  useOxygenColors,
} from './OxygenFormPrimitives';
import type { OxygenBank, OxygenFields } from './oxygen-form-utils';
export interface OxygenBankStepProps {
  fields: OxygenFields;
  banks: readonly OxygenBank[];
  onChange: (patch: OxygenFields) => void;
  onResolveAccount: (
    bankCode: string,
    accountNumber: string
  ) => Promise<string>;
  onAccountName?: (name: string) => void;
  active: boolean;
  busy?: boolean;
  errors?: Partial<Record<keyof OxygenFields, string>>;
}
export function OxygenBankStep({
  fields,
  banks,
  onChange,
  onResolveAccount,
  onAccountName,
  active,
  busy,
  errors,
}: OxygenBankStepProps) {
  const colors = useOxygenColors();
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);
  const generation = useRef(0);
  const resolveRef = useRef(onResolveAccount);
  resolveRef.current = onResolveAccount;
  const nameRef = useRef(onAccountName);
  nameRef.current = onAccountName;
  // biome-ignore lint/correctness/useExhaustiveDependencies: lookupAttempt is an explicit retry of this read-only lookup.
  useEffect(() => {
    const revision = ++generation.current;
    setName('');
    setError('');
    setResolving(false);
    nameRef.current?.('');
    if (
      !active ||
      !fields.bank_code ||
      !/^\d{10}$/.test(fields.account_number ?? '')
    )
      return;
    setResolving(true);
    void resolveRef
      .current(fields.bank_code, fields.account_number ?? '')
      .then(
        (result) => {
          if (generation.current === revision) {
            setName(result);
            nameRef.current?.(result);
          }
        },
        () => {
          if (generation.current === revision)
            setError(
              'Could not confirm the account name. Check the details and try again.'
            );
        }
      )
      .finally(() => {
        if (generation.current === revision) setResolving(false);
      });
    return () => {
      generation.current++;
    };
  }, [fields.bank_code, fields.account_number, active, lookupAttempt]);
  return (
    <View>
      <OxygenBankPicker
        banks={banks}
        value={fields.bank_code}
        disabled={busy || !active || !banks.length}
        onChange={(bank_code) => onChange({ bank_code })}
      />
      <OxygenField
        label="Account number"
        keyboardType="number-pad"
        value={fields.account_number}
        onChange={(value) =>
          onChange({ account_number: value.replace(/\D/g, '').slice(0, 10) })
        }
        editable={!busy && active}
        error={errors?.account_number}
      />
      {resolving || name ? (
        <View
          style={{
            backgroundColor: colors.muted,
            borderWidth: 1,
            borderColor: colors.border,
            padding: 16,
            borderRadius: 14,
            gap: 6,
          }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            Account name
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: colors.text, fontWeight: '600', fontSize: 16 }}
          >
            {resolving ? 'Verifying account…' : name}
          </Text>
          {name ? (
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={16}
                color={colors.success}
              />
              <Text
                style={{
                  color: colors.success,
                  fontSize: 13,
                  fontWeight: '500',
                }}
              >
                Account verified
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </Text>
          <OxygenButton
            title="Try again"
            secondary
            disabled={busy || !active}
            onPress={() => setLookupAttempt((current) => current + 1)}
          />
        </View>
      ) : null}
    </View>
  );
}
