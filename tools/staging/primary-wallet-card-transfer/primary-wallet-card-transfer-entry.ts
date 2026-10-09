import { primaryCardTransferCli } from './primary-wallet-card-transfer-cli';

primaryCardTransferCli(process.argv.slice(2)).then(
  (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    // Readiness runs as ExecStartPre: it must pass whenever the worker can
    // run, even with a stuck-sibling backlog — failing the probe on
    // reconciliation_required would skip ExecStart and deadlock --once
    // against the very backlog it is built to drain. The non-zero signal
    // for operator attention belongs to --once runs only.
    if (result.mode === 'once' && result.status === 'reconciliation_required') {
      process.stderr.write('Primary card transfer reconciliation required\n');
      process.exitCode = 2;
    }
  },
  () => {
    process.stderr.write('Primary card transfer worker unavailable\n');
    process.exitCode = 1;
  }
);
