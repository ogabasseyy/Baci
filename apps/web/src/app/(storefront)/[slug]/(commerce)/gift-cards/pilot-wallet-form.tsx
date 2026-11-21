'use client';

import { useActionState } from 'react';
import { runPilotWalletAction } from './pilot-wallet-action';

export function PilotWalletForm() {
  const [state, action, pending] = useActionState(runPilotWalletAction, {
    status: 'idle',
  });

  if (state.status === 'confirmed') {
    return (
      <p role="status">
        Wallet payment recorded. Order reference: {state.orderId}
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-md border p-4">
      <h2 className="font-semibold">PlayStation US $10 wallet pilot</h2>
      {state.status === 'quote' && (
        <>
          <p role="status">
            {new Intl.NumberFormat('en-NG', {
              style: 'currency',
              currency: 'NGN',
            }).format(state.totalKobo / 100)}
          </p>
          <p>
            Confirm within 60 seconds. We’ll recheck the price before charging.
          </p>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="region" value="US" required />
            My PlayStation account region is United States.
          </label>
          <input type="hidden" name="token" value={state.token} />
          <input type="hidden" name="expiresAt" value={state.expiresAt} />
        </>
      )}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      <button
        type="submit"
        name="intent"
        value={state.status === 'quote' ? 'confirm' : 'quote'}
        disabled={pending}
        className="min-h-11 rounded-md border px-4 py-2 font-semibold"
      >
        {state.status === 'quote'
          ? 'Confirm wallet payment'
          : 'Get pilot price'}
      </button>
    </form>
  );
}
