import { fileURLToPath } from 'node:url';
import { materializeHostedSavings } from './hosted-savings-materialize';

void materializeHostedSavings(
  process.argv.slice(2),
  fileURLToPath(new URL('../../', import.meta.url))
)
  .then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
  .catch(() => {
    process.stderr.write(
      'Materialization failed closed; no SQL executed and no partial bundle retained.\n'
    );
    process.exitCode = 1;
  });
