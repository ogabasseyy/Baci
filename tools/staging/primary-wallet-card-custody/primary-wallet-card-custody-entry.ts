import { primaryCardCustodyCli } from './primary-wallet-card-custody-cli';

primaryCardCustodyCli(process.argv.slice(2)).then(
  (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
  () => {
    process.stderr.write('Primary card custody launch unavailable\n');
    process.exitCode = 1;
  }
);
