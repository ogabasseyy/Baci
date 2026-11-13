import { useWalletFundPromptStore } from './wallet-fund-prompt-store';

/** Answers the waiting funding question once, then removes it. */
export function answerWalletFundPrompt(confirmed: boolean) {
  const { prompt } = useWalletFundPromptStore.getState();
  if (!prompt) return;
  useWalletFundPromptStore.setState({ prompt: null });
  prompt.resolve(confirmed);
}
