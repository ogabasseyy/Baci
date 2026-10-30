import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { RUN_MODES, SANDBOX_ORIGIN } from './constants';
import { buildEvidence, renderMarkdown } from './evidence';
import { type WrittenEvidence, writeEvidence } from './evidence-writer';
import { createGuardedFetch } from './guarded-fetch';
import { createMockProvider, MOCK_API_KEY } from './mock-provider';
import { MutationGate } from './mutation-gate';
import {
  createFileJournal,
  createMemoryJournal,
  type Journal,
} from './mutation-journal';
import { runProof1 } from './proof-1-return-if-exist';
import { runProof2 } from './proof-2-tsq';
import { runProof3 } from './proof-3-goal-deposit';
import { runProof4 } from './proof-4-withdrawal-counter';
import { runProof5 } from './proof-5-interest';
import { runProof6 } from './proof-6-fees';
import { runProof7 } from './proof-7-interest-routing';
import { emptyScenarioState, type ProofContext } from './proof-context';
import { ProviderApi, qaIdentityFor } from './provider-ops';
import { loadAllowlist } from './qa-allowlist';
import { Redactor } from './redactor';
import { ResponseCapture } from './response-capture';
import type { RunConfig } from './run-mode';
import {
  assertSandboxBaseUrl,
  assertTestKey,
  HarnessRefusal,
} from './safety-guards';
import { setupScenario } from './scenario';
import type { ProofId, ProofResult } from './types';

export type ProofRunner = (ctx: ProofContext) => Promise<ProofResult>;

const PROOF_ORDER: ReadonlyArray<readonly [ProofId, ProofRunner, string]> = [
  ['p1', runProof1, 'Create-customer re-POST with returnIfExist=true'],
  [
    'p2',
    runProof2,
    'Transaction status query (TSQ) for a wallet-to-wallet transfer',
  ],
  [
    'p3',
    runProof3,
    "Bank deposit into a goal sub-wallet's own virtual account",
  ],
  ['p4', runProof4, 'Withdrawal counter (wallet-to-wallet vs bank outflow)'],
  ['p5', runProof5, 'Interest visibility (development evidence only)'],
  ['p6', runProof6, 'Fees on deposits and wallet transfers'],
  ['p7', runProof7, 'Main-wallet interest routing at creation'],
];

export interface RunDeps {
  /** Live transport. Defaults to the global fetch captured BEFORE the guard is installed. */
  fetchImpl?: typeof fetch;
  print?: (text: string) => void;
  write?: typeof writeEvidence;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  proofRunners?: Partial<Record<ProofId, ProofRunner>>;
  /** Used when the config names no --evidence-dir. */
  defaultEvidenceDir?: string;
  homeDir?: string;
}

export interface RunSummary {
  mode: RunConfig['mode'];
  exitCode: 0 | 1;
  proofs: { proof: ProofId; status: ProofResult['status'] }[];
  evidence: WrittenEvidence | null;
  spentKobo: number;
}

/** Resume the newest attempt; `--new-attempt` opens the next one. */
export function currentAttempt(journal: Journal, newAttempt: boolean): number {
  const latest = Math.max(
    0,
    ...journal.entries().map((entry) => entry.attempt)
  );
  if (latest === 0) return 1;
  return newAttempt ? latest + 1 : latest;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runHarness(
  config: RunConfig,
  deps: RunDeps = {}
): Promise<RunSummary> {
  const live = config.mode !== 'dry-run';
  const print =
    deps.print ?? ((text: string) => process.stdout.write(`${text}\n`));
  const transport = deps.fetchImpl ?? globalThis.fetch;

  if (!(RUN_MODES as readonly string[]).includes(config.mode)) {
    throw new HarnessRefusal('USAGE', 'unknown run mode');
  }
  assertSandboxBaseUrl(config.baseUrl);
  const mock = live ? null : createMockProvider();
  const token = live ? (config.apiKey ?? undefined) : MOCK_API_KEY;
  assertTestKey(token);
  const allowlist = config.allowlistPath
    ? loadAllowlist(config.allowlistPath)
    : { qaCustomerIds: ['mock-qa-customer-0001'] };
  if (live && !config.allowlistPath) {
    throw new HarnessRefusal(
      'ALLOWLIST_REQUIRED',
      'live modes need an allowlist'
    );
  }
  const qaKey = config.qaCustomerId ?? allowlist.qaCustomerIds[0];
  if (!allowlist.qaCustomerIds.includes(qaKey)) {
    throw new HarnessRefusal(
      'ALLOWLIST_INVALID',
      'the selected QA customer is not on the allowlist'
    );
  }

  const journal: Journal =
    config.mode === 'live-sandbox-mutations'
      ? createFileJournal(
          config.journalPath ??
            path.join(
              deps.homeDir ?? homedir(),
              '.baci',
              'piggyvest-contract-proofs',
              'journal.jsonl'
            )
        )
      : createMemoryJournal();
  try {
    const state = emptyScenarioState();
    const capture = new ResponseCapture();
    const attempt = currentAttempt(journal, config.newAttempt);
    const gate = new MutationGate({
      mode: config.mode,
      journal,
      runId: `r${Date.now().toString(36)}${randomBytes(2).toString('hex')}`,
      attempt,
      isWalletAuthorized: (walletId) => state.authorized.has(walletId),
      now: deps.now,
    });
    const guarded = createGuardedFetch({
      mode: config.mode,
      origin: SANDBOX_ORIGIN,
      baseFetch: mock ? mock.fetch : transport,
      gate,
      capture,
      minGapMs: live ? 200 : 0,
      sleep: deps.sleep,
    });
    const redactor = new Redactor();
    const ctx: ProofContext = {
      mode: config.mode,
      api: new ProviderApi(
        { baseUrl: SANDBOX_ORIGIN, token: token ?? '' },
        capture,
        gate
      ),
      redactor,
      qa: qaIdentityFor(qaKey),
      state,
      sleep: live ? (deps.sleep ?? realSleep) : async () => undefined,
      pollIntervalMs: live ? 2_000 : 0,
      maxPolls: live ? 15 : 6,
      attempt,
      bank: !live
        ? { code: '058', account: '0123456789' }
        : config.bankCode && config.bankAccount
          ? { code: config.bankCode, account: config.bankAccount }
          : null,
      businessWalletId: mock
        ? mock.sandbox.businessWalletId
        : config.businessWalletId,
    };

    const proofs: ProofResult[] = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = guarded; // the typed client calls the global; nothing bypasses the guard
    try {
      await setupScenario(ctx);
      for (const [id, defaultRunner, title] of PROOF_ORDER) {
        const runner = deps.proofRunners?.[id] ?? defaultRunner;
        try {
          proofs.push(await runner(ctx));
        } catch (error) {
          if (error instanceof HarnessRefusal) throw error;
          proofs.push({
            proof: id,
            title,
            status: 'failed',
            reason: `unexpected ${error instanceof Error ? error.name : 'error'}; details withheld`,
            findings: [],
            shapes: [],
            values: {},
            notes: [],
          });
        }
      }
    } finally {
      globalThis.fetch = previousFetch;
    }

    const doc = buildEvidence({
      date: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
      mode: config.mode,
      mockData: !live,
      proofs,
    });
    let evidence: WrittenEvidence | null = null;
    if (live) {
      const dir = config.evidenceDir ?? deps.defaultEvidenceDir;
      if (!dir)
        throw new HarnessRefusal('USAGE', 'no evidence directory configured');
      evidence = (deps.write ?? writeEvidence)({
        mode: config.mode,
        doc,
        redactor,
        dir,
      });
    } else {
      const markdown = renderMarkdown(doc);
      redactor.assertClean(markdown);
      print(markdown);
    }
    return {
      mode: config.mode,
      exitCode: proofs.some((proof) => proof.status === 'failed') ? 1 : 0,
      proofs: proofs.map(({ proof, status }) => ({ proof, status })),
      evidence,
      spentKobo: gate.spentKobo(),
    };
  } finally {
    journal.release?.(); // a lock left behind would block the next run
  }
}
