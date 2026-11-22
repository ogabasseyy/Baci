import { useEffect, useState } from 'react';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenBank } from './oxygen-form-utils';

const bankLoadError =
  'Could not load banks. Check your connection and try again.';

export function useOxygenBanks(
  client: OxygenClient,
  workflowId: string,
  editing: boolean
) {
  const [banks, setBanks] = useState<OxygenBank[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt triggers the customer's explicit retry.
  useEffect(() => {
    setBanks([]);
    setError(null);
    if (!editing) return;
    let live = true;
    void client.bankDetails({ action: 'banks', workflowId }).then(
      (result) => {
        if (!live) return;
        if ('banks' in result && result.banks.length) setBanks(result.banks);
        else setError(bankLoadError);
      },
      () => {
        if (live) setError(bankLoadError);
      }
    );
    return () => {
      live = false;
    };
  }, [client, workflowId, editing, attempt]);
  return { banks, error, retry: () => setAttempt((current) => current + 1) };
}
