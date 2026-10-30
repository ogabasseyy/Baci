import type { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';

export function primarySetupMock(): ReturnType<typeof usePiggyvestWalletSetup> {
  return {
    account: null,
    state: 'not_started',
    justCreated: false,
    acknowledgeReady: () => undefined,
    delayed: false,
    hasCheckError: false,
    isChecking: false,
    submitting: false,
    refresh: () => undefined,
    submit: async () => undefined,
  };
}
