import { create } from 'zustand';

export type WalletFundPrompt = {
  title: string;
  message: string;
  confirmLabel: string;
  /** The signed-in customer and store it was asked for. */
  scope: string;
  resolve: (confirmed: boolean) => void;
};

/**
 * The one funding question waiting for an answer (resume a saved card
 * funding, authorise a one-time charge, try the rail check again). It is
 * answered inline in the add money sheet, or on the wallet when the sheet
 * is closed, never in an iOS alert.
 */
export const useWalletFundPromptStore = create<{
  prompt: WalletFundPrompt | null;
}>(() => ({ prompt: null }));
