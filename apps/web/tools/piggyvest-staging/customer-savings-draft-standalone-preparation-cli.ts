import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createCustomerSavingsDraftSourceSnapshot,
  prepareCustomerSavingsDraftStandaloneAssets,
  verifyCustomerSavingsDraftStandaloneOutput,
} from './customer-savings-draft-standalone-preparation';

type PreparationDependencies = {
  createSnapshot: typeof createCustomerSavingsDraftSourceSnapshot;
  prepareAssets: typeof prepareCustomerSavingsDraftStandaloneAssets;
  verifyOutput: typeof verifyCustomerSavingsDraftStandaloneOutput;
};

export function runCustomerSavingsDraftStandalonePreparationCli(
  argumentsList: readonly string[] = process.argv.slice(2),
  dependencies: Partial<PreparationDependencies> = {}
): Promise<unknown> {
  const createSnapshot =
    dependencies.createSnapshot ?? createCustomerSavingsDraftSourceSnapshot;
  const prepareAssets =
    dependencies.prepareAssets ?? prepareCustomerSavingsDraftStandaloneAssets;
  const verifyOutput =
    dependencies.verifyOutput ?? verifyCustomerSavingsDraftStandaloneOutput;
  const [command, ...argumentsAfterCommand] = argumentsList;

  if (command === 'snapshot' && argumentsAfterCommand.length === 2)
    return createSnapshot({
      repositoryRoot: argumentsAfterCommand[0],
      destination: argumentsAfterCommand[1],
    });
  if (command === 'prepare' && argumentsAfterCommand.length === 1)
    return prepareAssets(argumentsAfterCommand[0]);
  if (command === 'verify' && argumentsAfterCommand.length === 1)
    return verifyOutput(argumentsAfterCommand[0]);

  throw new Error(
    'Usage: customer-savings-draft-standalone-preparation <snapshot <repository-root> <snapshot-destination>|prepare <apps/web/.next>|verify <apps/web/.next/standalone>>'
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void runCustomerSavingsDraftStandalonePreparationCli()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.message : 'Standalone preparation failed'
      );
      process.exitCode = 1;
    });
}
