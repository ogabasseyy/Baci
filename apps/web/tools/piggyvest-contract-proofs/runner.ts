import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  LIVE_MAX_POLLS,
  LIVE_POLL_INTERVAL_MS,
  RUN_MODES,
  SANDBOX_ORIGIN,
  STANDALONE_PROOFS,
} from './constants';
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
import { emptyScenarioState, type ProofContext } from './proof-context';
import type { ProofRunner } from './proof-extension';
import { PROOF_ORDER } from './proof-order';
import { qaIdentityFor } from './provider-ops';
import { ProofApi } from './provider-ops-proofs';
import { loadAllowlist } from './qa-allowlist';
import { isDerivedKeyOf, isProof7KeyOf } from './qa-keys';
import { Redactor } from './redactor';
import { ResponseCapture } from './response-capture';
import { assertProofScope, type RunConfig } from './run-mode';
import {
  assertSandboxBaseUrl,
  assertTestKey,
  HarnessRefusal,
} from './safety-guards';
import { setupScenario } from './scenario';
import { TransportFaults } from './transport-faults';
import type { ProofId, ProofResult } from './types';

export type { ProofRunner } from './proof-extension';

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

/**
 * The attempt number is per QA customer (its own entries plus its derived
 * proof-7 keys); another customer's `--new-attempt` never moves it.
 * `--new-attempt` opens one above every attempt this customer has used. A run
 * that includes the shared scenario resumes the newest attempt holding the
 * customer's OWN entries: an attempt opened by a proof-7-only run holds only
 * proof-7 slots, and resuming it would make every executed scenario slot look
 * fresh and send it again. A proof-7-only run resumes the newest of either.
 */
export function currentAttempt(
  journal: Journal,
  qaKey: string,
  newAttempt: boolean,
  includesScenario: boolean
): number {
  const entries = journal.entries();
  const own = entries
    .filter((entry) => entry.qaKey === qaKey)
    .map((entry) => entry.attempt);
  const derived = entries
    .filter((entry) => isDerivedKeyOf(qaKey, entry.qaKey))
    .map((entry) => entry.attempt);
  const latest = Math.max(0, ...own, ...derived);
  if (latest === 0) return 1;
  if (newAttempt) return latest + 1;
  return includesScenario && own.length > 0 ? Math.max(...own) : latest;
}

/**
 * A full run runs proof 7 under the scenario's attempt. If a proof-7-only
 * `--new-attempt` moved proof 7 past it without it ever running on the scenario's
 * attempt, proof 7 would find nothing journaled
 * and create a second sandbox customer (a resend). Refuse instead.
 */
export function assertProof7AttemptAligned(
  journal: Journal,
  qaKey: string,
  attempt: number
): void {
  const proof7 = journal
    .entries()
    .filter((entry) => isProof7KeyOf(qaKey, entry.qaKey))
    .map((entry) => entry.attempt);
  const newest = Math.max(0, ...proof7);
  if (newest > attempt && !proof7.includes(attempt)) {
    throw new HarnessRefusal(
      'USAGE',
      `proof 7 never ran on attempt ${attempt} but is on ${newest}; pass --new-attempt, or run --proof p7`
    );
  }
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
  assertProofScope(config.proof, config.newAttempt);
  const only = config.proof;
  // A standalone proof run alone needs no shared customer, goal or funding.
  const includesScenario = !only || !STANDALONE_PROOFS.includes(only);
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
    const attempt = currentAttempt(
      journal,
      qaKey,
      config.newAttempt,
      includesScenario
    );
    if (!only && !config.newAttempt) {
      assertProof7AttemptAligned(journal, qaKey, attempt);
    }
    const gate = new MutationGate({
      mode: config.mode,
      journal,
      runId: `r${Date.now().toString(36)}${randomBytes(2).toString('hex')}`,
      attempt,
      isWalletAuthorized: (walletId) => state.authorized.has(walletId),
      now: deps.now,
    });
    const faults = new TransportFaults();
    const guarded = createGuardedFetch({
      mode: config.mode,
      origin: SANDBOX_ORIGIN,
      baseFetch: faults.wrap(mock ? mock.fetch : transport),
      gate,
      capture,
      minGapMs: live ? 200 : 0,
      sleep: deps.sleep,
    });
    const redactor = new Redactor();
    const ctx: ProofContext = {
      mode: config.mode,
      api: new ProofApi(
        { baseUrl: SANDBOX_ORIGIN, token: token ?? '' },
        capture,
        gate
      ),
      redactor,
      qa: qaIdentityFor(qaKey),
      state,
      sleep: live ? (deps.sleep ?? realSleep) : async () => undefined,
      pollIntervalMs: live ? LIVE_POLL_INTERVAL_MS : 0,
      maxPolls: live ? LIVE_MAX_POLLS : 6,
      attempt,
      faults,
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
      if (includesScenario) await setupScenario(ctx);
      const order = only
        ? PROOF_ORDER.filter(([id]) => id === only)
        : PROOF_ORDER;
      for (const [id, defaultRunner, title] of order) {
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
