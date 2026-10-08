import { primaryCardTransferCli } from './primary-wallet-card-transfer-cli';

primaryCardTransferCli(process.argv.slice(2)).then(
  (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'reconciliation_required') {
      process.stderr.write('Primary card transfer reconciliation required\n');
      process.exitCode = 2;
    }
  },
  () => {
    process.stderr.write('Primary card transfer worker unavailable\n');
    process.exitCode = 1;
  }
);
