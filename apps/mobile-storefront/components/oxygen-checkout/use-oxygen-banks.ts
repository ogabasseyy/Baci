import { useEffect, useState } from 'react';
import type { OxygenClient } from '@/services/oxygen/client';
import type { OxygenBank } from './oxygen-form-utils';
export function useOxygenBanks(
  client: OxygenClient,
  workflowId: string,
  editing: boolean,
  onError: (message: string) => void
) {
  const [banks, setBanks] = useState<OxygenBank[]>([]);
  useEffect(() => {
    if (!editing) return;
    let live = true;
    void client.bankDetails({ action: 'banks', workflowId }).then(
      (result) => {
        if (live && 'banks' in result) setBanks(result.banks);
      },
      () => {
        if (live)
          onError('Could not load banks. Check your connection and try again.');
      }
    );
    return () => {
      live = false;
    };
  }, [client, workflowId, editing, onError]);
  return banks;
}
