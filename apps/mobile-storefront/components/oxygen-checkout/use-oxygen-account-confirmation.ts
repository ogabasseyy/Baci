import { useEffect, useState } from 'react';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenFields } from './oxygen-form-utils';

/** Confirmation belongs to this workflow and exact account, never to a saved name. */
export function useOxygenAccountConfirmation({
  client,
  workflowId,
  scopeKey,
  fields,
  step,
  loaded,
  active,
}: {
  client: OxygenClient;
  workflowId: string;
  scopeKey: string;
  fields: OxygenFields;
  step: 0 | 1 | 2;
  loaded: boolean;
  active: boolean;
}) {
  const bankCode = fields.bank_code;
  const accountNumber = fields.account_number;
  const key = JSON.stringify([scopeKey, workflowId, bankCode, accountNumber]);
  const [confirmation, setConfirmation] = useState({ key: '', name: '' });
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const accountName = confirmation.key === key ? confirmation.name : '';
  async function resolveAccount(bank_code: string, account_number: string) {
    const result = await client.bankDetails({
      action: 'resolve',
      workflowId,
      bank_code,
      account_number,
    });
    if (!('accountName' in result) || !result.accountName.trim())
      throw new Error('Account unavailable');
    return result.accountName;
  }
  useEffect(() => {
    if (
      !loaded ||
      !active ||
      step !== 2 ||
      accountName ||
      !bankCode ||
      !/^\d{10}$/.test(accountNumber ?? '')
    )
      return;
    let live = true;
    setPending(key);
    setFailure(null);
    void client
      .bankDetails({
        action: 'resolve',
        workflowId,
        bank_code: bankCode,
        account_number: accountNumber ?? '',
      })
      .then((result) => {
        if (!live) return;
        if (!('accountName' in result) || !result.accountName.trim())
          throw new Error('Account unavailable');
        setConfirmation({ key, name: result.accountName });
      })
      .catch(() => {
        if (live)
          setFailure({
            key,
            message:
              'We could not confirm your saved bank account. Go back to the Bank step and try again.',
          });
      })
      .finally(() => {
        if (live) setPending(null);
      });
    return () => {
      live = false;
    };
  }, [
    client,
    workflowId,
    key,
    bankCode,
    accountNumber,
    loaded,
    active,
    step,
    accountName,
  ]);
  return {
    accountName,
    checking: pending === key && !accountName,
    error: failure?.key === key ? failure.message : null,
    resolveAccount,
    confirm: (name: string) => {
      setConfirmation({ key, name });
      setFailure(null);
    },
  };
}
