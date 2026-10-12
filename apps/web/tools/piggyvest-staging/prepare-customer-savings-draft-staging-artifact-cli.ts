import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareCustomerSavingsDraftStagingArtifact } from './prepare-customer-savings-draft-staging-artifact';

type ArtifactPreparer = (output: string) => Promise<void>;

export async function runPrepareCustomerSavingsDraftStagingArtifactCli(
  argumentsList: readonly string[] = process.argv.slice(2),
  prepare: ArtifactPreparer = prepareCustomerSavingsDraftStagingArtifact
): Promise<void> {
  if (argumentsList.length !== 1 || argumentsList[0].trim() === '')
    throw new Error(
      'Usage: prepare-customer-savings-draft-staging-artifact <.vercel/output-directory>'
    );
  await prepare(argumentsList[0]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void runPrepareCustomerSavingsDraftStagingArtifactCli().catch(
    (error: unknown) => {
      console.error(
        error instanceof Error ? error.message : 'Artifact preparation failed'
      );
      process.exitCode = 1;
    }
  );
}
