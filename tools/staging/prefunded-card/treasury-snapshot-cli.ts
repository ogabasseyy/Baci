import { readPrefundedCardTreasurySnapshotConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-snapshot-config-file';
import { createPrefundedCardTreasurySnapshotStore } from '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-snapshot-store';
import type { PrefundedTreasurySnapshotStore } from '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-verifier';
import { verifyPrefundedCardTreasurySnapshot } from '../../../apps/web/src/lib/piggyvest/prefunded-card-treasury-verifier';
import type { PrefundedCardTreasurySnapshotConfig } from '../../../apps/web/src/schemas/prefunded-card-treasury-snapshot-config';

type VerificationResult = Awaited<
  ReturnType<typeof verifyPrefundedCardTreasurySnapshot>
>;
type RefusalReason = Extract<
  VerificationResult,
  { outcome: 'refused' }
>['reason'];

type CliDependencies = {
  readConfiguration(
    filePath: string
  ): ReturnType<typeof readPrefundedCardTreasurySnapshotConfig>;
  createStore(configuration: unknown): {
    store: PrefundedTreasurySnapshotStore;
    close(): Promise<void>;
  };
  verifySnapshot(input: {
    configuration: unknown;
    store: PrefundedTreasurySnapshotStore;
    fetchImplementation: typeof fetch;
  }): Promise<VerificationResult>;
  fetchImplementation: typeof fetch;
};

const defaultDependencies: CliDependencies = {
  readConfiguration: readPrefundedCardTreasurySnapshotConfig,
  createStore: createPrefundedCardTreasurySnapshotStore,
  verifySnapshot: verifyPrefundedCardTreasurySnapshot,
  fetchImplementation: fetch,
};

export async function runPrefundedCardTreasurySnapshotCli({
  configPath,
  dependencies = defaultDependencies,
  writeLine = (line) => process.stdout.write(`${line}\n`),
}: {
  configPath?: string;
  dependencies?: CliDependencies;
  writeLine?: (line: string) => void;
}): Promise<number> {
  let outcome: 'recorded' | 'duplicate' | 'refused' = 'refused';
  let refusalReason: RefusalReason = 'invalid_configuration';
  let exitCode = 1;
  let adapter:
    | ReturnType<typeof createPrefundedCardTreasurySnapshotStore>
    | undefined;

  try {
    if (!configPath) throw new Error();
    const loaded = await dependencies.readConfiguration(configPath);
    if (!loaded.ok) throw new Error();
    const configuration: PrefundedCardTreasurySnapshotConfig =
      loaded.configuration;
    adapter = dependencies.createStore(configuration);
    const result = await dependencies.verifySnapshot({
      configuration: configuration.verifier,
      store: adapter.store,
      fetchImplementation: dependencies.fetchImplementation,
    });
    if (result.outcome === 'refused') {
      refusalReason = result.reason;
    } else {
      outcome = result.outcome;
      exitCode = 0;
    }
  } catch {
    outcome = 'refused';
    refusalReason = adapter
      ? 'snapshot_store_unavailable'
      : 'invalid_configuration';
    exitCode = 1;
  } finally {
    if (adapter) {
      try {
        await adapter.close();
      } catch {
        outcome = 'refused';
        refusalReason = 'snapshot_store_unavailable';
        exitCode = 1;
      }
    }
    writeLine(
      JSON.stringify(
        outcome === 'refused' ? { outcome, reason: refusalReason } : { outcome }
      )
    );
  }

  return exitCode;
}

if (typeof require === 'function' && require.main === module) {
  void runPrefundedCardTreasurySnapshotCli({
    configPath: process.argv[2],
  }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
