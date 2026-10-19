import { primaryWalletCardCheckoutAbandonmentCli } from './primary-wallet-card-checkout-abandonment-cli';

primaryWalletCardCheckoutAbandonmentCli(process.argv.slice(2)).then(
  (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
  () => {
    process.stderr.write('Primary card abandonment worker unavailable\n');
    process.exitCode = 1;
  }
);
