import { handleSavingsActionError } from './handle-savings-action-error';

// Hoisted: try/finally in a component body blocks React Compiler.
export async function runCopyFundingAccount(
  copyFundingAccount: () => Promise<void>,
  setIsCopying: (isCopying: boolean) => void
) {
  setIsCopying(true);
  try {
    await copyFundingAccount();
  } catch (error) {
    handleSavingsActionError(
      error,
      'Unable to copy account',
      'Failed to copy funding account. Please try again.'
    );
  } finally {
    setIsCopying(false);
  }
}
