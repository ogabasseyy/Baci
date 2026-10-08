import { runPrimaryWalletPaidInterestInboxCli } from '../../../apps/web/src/scripts/primary-wallet-paid-interest-inbox-worker-cli';

runPrimaryWalletPaidInterestInboxCli({ argv: process.argv.slice(2) }).then(
  (status) => {
    process.exitCode = status;
  }
);
