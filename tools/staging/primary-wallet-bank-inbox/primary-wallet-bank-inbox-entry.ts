import { primaryWalletBankInboxCli } from './primary-wallet-bank-inbox-cli';

primaryWalletBankInboxCli(process.argv.slice(2)).then(
  (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
  () => {
    process.stderr.write('Primary bank receipt worker unavailable\n');
    process.exitCode = 1;
  }
);
