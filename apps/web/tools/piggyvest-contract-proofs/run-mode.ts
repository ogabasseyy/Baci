import {
  ENV_API_KEY,
  ENV_API_KEY_FALLBACK,
  ENV_BANK_ACCOUNT,
  ENV_BANK_CODE,
  ENV_BASE_URL,
  ENV_BUSINESS_WALLET,
  FULL_RUN_ONLY_PROOFS,
  PROOF_IDS,
  RUN_MODES,
  type RunMode,
  SANDBOX_ORIGIN,
  STANDALONE_PROOFS,
} from './constants';
import {
  assertNoRecordingAccount,
  assertSandboxBaseUrl,
  assertTestKey,
  HarnessRefusal,
} from './safety-guards';
import type { ProofId } from './types';

export interface RunConfig {
  mode: RunMode;
  baseUrl: string;
  /** Null in dry-run: the harness never reads an ambient key there. */
  apiKey: string | null;
  allowlistPath: string | null;
  journalPath: string | null;
  evidenceDir: string | null;
  qaCustomerId: string | null;
  newAttempt: boolean;
  bankCode: string | null;
  bankAccount: string | null;
  /** Ogabassey business sandbox wallet (proof 7); live modes only. */
  businessWalletId: string | null;
  /** Run this proof only (--proof); null runs every proof. */
  proof: ProofId | null;
  help: boolean;
}

type Env = Record<string, string | undefined>;

const MODE_FLAGS = new Map<string, RunMode>([
  ['--dry-run', 'dry-run'],
  ['--live-readonly', 'live-readonly'],
  ['--live-sandbox-mutations', 'live-sandbox-mutations'],
]);
const VALUE_FLAGS = [
  '--allowlist',
  '--journal',
  '--evidence-dir',
  '--qa-customer',
  '--proof',
] as const;
const BOOLEAN_FLAGS = ['--new-attempt', '--help'] as const;

const usage = (detail: string): never => {
  throw new HarnessRefusal('USAGE', detail);
};

function resolveKey(env: Env): string | undefined {
  return env[ENV_API_KEY] || env[ENV_API_KEY_FALLBACK] || undefined;
}

function resolveBankDestination(
  env: Env
): Pick<RunConfig, 'bankCode' | 'bankAccount'> {
  const code = env[ENV_BANK_CODE];
  const account = env[ENV_BANK_ACCOUNT];
  if (!code && !account) return { bankCode: null, bankAccount: null };
  if (!code || !account) {
    return usage(
      `${ENV_BANK_CODE} and ${ENV_BANK_ACCOUNT} must be set together`
    );
  }
  if (!/^[A-Za-z0-9]{1,16}$/.test(code) || !/^\d{10}$/.test(account)) {
    return usage('bank destination must be a bank code and a 10-digit NUBAN');
  }
  assertNoRecordingAccount('bank destination', [code, account]);
  return { bankCode: code, bankAccount: account };
}

function resolveBusinessWallet(env: Env): string | null {
  const id = env[ENV_BUSINESS_WALLET];
  if (!id) return null;
  assertNoRecordingAccount('business wallet id', id);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
    return usage(
      `${ENV_BUSINESS_WALLET} must be a wallet id (8-128 letters, digits, - or _)`
    );
  }
  return id;
}

function resolveProof(value: string | undefined): ProofId | null {
  if (value === undefined) return null;
  const known = PROOF_IDS.find((id) => id === value);
  return known ?? usage(`--proof must be one of ${PROOF_IDS.join(', ')}`);
}

/**
 * What a --proof run may do. A proof that only measures other proofs' work
 * needs a full run. --new-attempt with a proof that runs the shared scenario
 * would open an attempt holding only that proof's slots, which the next plain
 * full run would then complete by sending every other proof's mutations; only
 * a standalone proof (its slots live under its own keys) may open one alone.
 */
export function assertProofScope(
  proof: ProofId | null,
  newAttempt: boolean
): void {
  if (!proof) return;
  if (FULL_RUN_ONLY_PROOFS.includes(proof)) {
    usage(
      `--proof ${proof} measures what other proofs do in the same run; run it in a full run`
    );
  }
  if (newAttempt && !STANDALONE_PROOFS.includes(proof)) {
    usage(
      `--new-attempt with --proof is allowed only for ${STANDALONE_PROOFS.join(', ')}; open a new attempt with a full run`
    );
  }
}

export function parseRunConfig(argv: readonly string[], env: Env): RunConfig {
  assertNoRecordingAccount('command line', argv);
  const modes = new Set<RunMode>();
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const flagMode = MODE_FLAGS.get(arg);
    if (flagMode) {
      modes.add(flagMode);
    } else if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        usage(`${arg} needs a value`);
      }
      values.set(arg, value);
      index += 1;
    } else if ((BOOLEAN_FLAGS as readonly string[]).includes(arg)) {
      flags.add(arg);
    } else {
      usage(`unknown argument (modes: ${RUN_MODES.join(', ')})`);
    }
  }
  if (modes.size > 1) {
    throw new HarnessRefusal('MODE_CONFLICT', 'choose exactly one run mode');
  }
  const mode: RunMode = [...modes][0] ?? 'dry-run';
  const baseUrl = assertSandboxBaseUrl(env[ENV_BASE_URL] ?? SANDBOX_ORIGIN);
  const allowlistPath = values.get('--allowlist') ?? null;
  const live = mode !== 'dry-run';

  let apiKey: string | null = null;
  if (live) {
    if (!allowlistPath) {
      throw new HarnessRefusal(
        'ALLOWLIST_REQUIRED',
        `${mode} needs --allowlist <file of QA customer ids>`
      );
    }
    const key = resolveKey(env);
    assertTestKey(key);
    apiKey = key ?? null;
  }
  const bank =
    mode === 'live-sandbox-mutations'
      ? resolveBankDestination(env)
      : { bankCode: null, bankAccount: null };
  const proof = resolveProof(values.get('--proof'));
  assertProofScope(proof, flags.has('--new-attempt'));

  return {
    mode,
    baseUrl,
    apiKey,
    allowlistPath,
    journalPath: values.get('--journal') ?? null,
    evidenceDir: values.get('--evidence-dir') ?? null,
    qaCustomerId: values.get('--qa-customer') ?? null,
    newAttempt: flags.has('--new-attempt'),
    proof,
    help: flags.has('--help'),
    // Read-only runs may read the binding (a GET); admission withholds
    // authorization there, so nothing is ever sent to this wallet.
    businessWalletId: live ? resolveBusinessWallet(env) : null,
    ...bank,
  };
}
