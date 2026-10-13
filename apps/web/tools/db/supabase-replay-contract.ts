import type {
  PendingRepairState,
  ProductionOldCancellationProofMode,
  ReplayCommand,
  SupabaseHistoryEffectComparisonMode,
  SupabaseHistoryReplayMode,
} from './supabase-history-replay-types';

const DEFAULT_PSQL_BIN = '/opt/homebrew/opt/libpq/bin/psql';
const DEFAULT_REPLAY_COMMAND_TIMEOUT_MS = 5 * 60_000;
const MAX_REPLAY_COMMAND_TIMEOUT_MS = 60 * 60_000;
const STATUS_OUTPUT_LIMIT = 64 * 1024;

function mismatch(tool: string): never {
  throw new Error(`${tool} version mismatch`);
}

export function createSupabaseReplayDatabaseEnvironment(
  databaseUrl: string,
  environment: Partial<NodeJS.ProcessEnv> = process.env
): NodeJS.ProcessEnv {
  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const database = decodeURIComponent(parsed.pathname.slice(1));
    const password = decodeURIComponent(parsed.password);
    const user = decodeURIComponent(parsed.username);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !isSupabaseReplayLoopbackHost(parsed.hostname) ||
      !parsed.port ||
      !database ||
      database.includes('/') ||
      !password ||
      !user ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
    const inherited = Object.fromEntries(
      Object.entries(environment).filter(([key]) => !key.startsWith('PG'))
    );
    return {
      ...inherited,
      PGCONNECT_TIMEOUT: '5',
      PGDATABASE: database,
      PGHOST: host,
      PGPASSWORD: password,
      PGPORT: parsed.port,
      PGUSER: user,
    } as unknown as NodeJS.ProcessEnv;
  } catch {
    throw new Error('Supabase replay database URL is not supported');
  }
}

async function stdout(
  runCommand: ReplayCommand,
  command: string,
  args: readonly string[]
): Promise<string> {
  return (await runCommand(command, args)).stdout.trim();
}

export function isSupabaseReplayLoopbackHost(host: string): boolean {
  const normalized = host.startsWith('[') ? host.slice(1, -1) : host;
  if (normalized === 'localhost' || normalized === '::1') return true;
  const octets = normalized.split('.');
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every(
      (octet) =>
        /^\d{1,3}$/.test(octet) &&
        Number.parseInt(octet, 10) >= 0 &&
        Number.parseInt(octet, 10) <= 255
    )
  );
}

export function assertSupabaseReplayDatabaseUrl(
  databaseUrl: string,
  expectedPort: number
): void {
  try {
    const parsed = new URL(databaseUrl);
    const port = Number.parseInt(parsed.port, 10);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !isSupabaseReplayLoopbackHost(parsed.hostname) ||
      port !== expectedPort
    ) {
      throw new Error();
    }
  } catch {
    throw new Error('Supabase replay database URL is not owned loopback');
  }
}

export async function readSupabaseReplayDatabaseUrl(
  runCommand: ReplayCommand,
  workdir: string
): Promise<string> {
  const { stdout } = await runCommand('supabase', [
    'status',
    '--workdir',
    workdir,
    '-o',
    'env',
  ]);
  if (
    Buffer.byteLength(stdout) > STATUS_OUTPUT_LIMIT ||
    stdout.includes('\0')
  ) {
    throw new Error('Supabase replay status is invalid');
  }
  const matches = [...stdout.matchAll(/^DB_URL="([^"\r\n]+)"$/gm)];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw new Error('Supabase replay status is invalid');
  }
  return matches[0][1];
}

export function readReplayCommandExecutionTimeoutMs(
  environment: Partial<NodeJS.ProcessEnv> = process.env
): number {
  const raw = environment.BACI_REPLAY_COMMAND_TIMEOUT_MS;
  if (raw === undefined || raw === '') {
    return DEFAULT_REPLAY_COMMAND_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1_000 ||
    parsed > MAX_REPLAY_COMMAND_TIMEOUT_MS
  ) {
    throw new Error('BACI_REPLAY_COMMAND_TIMEOUT_MS is invalid');
  }
  return parsed;
}

export function parseSupabaseReplayArguments(argv: readonly string[]): {
  comparisonMode: SupabaseHistoryEffectComparisonMode;
  mode: SupabaseHistoryReplayMode;
  pendingRepairState: PendingRepairState;
  productionOldCancellationProof: ProductionOldCancellationProofMode;
  receiptOutput?: string;
  sqlChecks: string[];
  typesOutput?: string;
} {
  try {
    const values: Record<string, string | undefined> = {};
    const sqlChecks: string[] = [];
    const allowed = new Set([
      '--mode',
      '--comparison-mode',
      '--pending-repair-state',
      '--production-old-cancellation-proof',
      '--receipt-output',
      '--sql-check',
      '--types-output',
    ]);
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (!flag || !allowed.has(flag) || !value || value.startsWith('--')) {
        throw new Error();
      }
      if (flag === '--sql-check') sqlChecks.push(value);
      else {
        if (values[flag]) throw new Error();
        values[flag] = value;
      }
    }
    const mode = values['--mode'];
    const comparisonMode = values['--comparison-mode'] ?? 'enforce';
    const productionOldCancellationProof =
      values['--production-old-cancellation-proof'] ?? 'skip';
    const state = values['--pending-repair-state'];
    if (
      !['chronological', 'production-effect'].includes(mode ?? '') ||
      !['classify', 'enforce'].includes(comparisonMode) ||
      !['required', 'skip'].includes(productionOldCancellationProof) ||
      !['materialized', 'not-materialized'].includes(state ?? '')
    ) {
      throw new Error();
    }
    return {
      comparisonMode: comparisonMode as SupabaseHistoryEffectComparisonMode,
      mode: mode as SupabaseHistoryReplayMode,
      pendingRepairState: state as PendingRepairState,
      productionOldCancellationProof:
        productionOldCancellationProof as ProductionOldCancellationProofMode,
      ...(values['--receipt-output']
        ? { receiptOutput: values['--receipt-output'] }
        : {}),
      sqlChecks,
      ...(values['--types-output']
        ? { typesOutput: values['--types-output'] }
        : {}),
    };
  } catch {
    throw new Error('Invalid Supabase replay arguments');
  }
}

export async function verifySupabaseReplayContract(options: {
  nodeVersion?: string;
  psqlBin?: string;
  runCommand: ReplayCommand;
}): Promise<{
  nodeMajor: 24;
  psqlBin: string;
  serverVersionNum: 170006;
}> {
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
  if (nodeMajor !== 24) mismatch('node');

  if ((await stdout(options.runCommand, 'pnpm', ['--version'])) !== '11.7.0') {
    mismatch('pnpm');
  }
  if (
    (await stdout(options.runCommand, 'pnpm', [
      '--filter',
      '@baci/web',
      'exec',
      'tsc',
      '--version',
    ])) !== 'Version 7.0.2'
  ) {
    mismatch('typescript');
  }
  const tsxLines = (
    await stdout(options.runCommand, 'pnpm', [
      '--filter',
      '@baci/web',
      'exec',
      'tsx',
      '--version',
    ])
  ).split('\n');
  if (tsxLines[0] !== 'tsx v4.22.4') mismatch('tsx');
  if (!/^node v24[.]\d+[.]\d+$/.test(tsxLines[1] ?? '')) {
    mismatch('tsx-node');
  }
  if (
    (await stdout(options.runCommand, 'supabase', ['--version'])) !== '2.95.4'
  ) {
    mismatch('supabase');
  }
  const psqlBin = options.psqlBin ?? process.env.PSQL_BIN ?? DEFAULT_PSQL_BIN;
  if (
    !/^psql \(PostgreSQL\) 18\.3(?: \(.+\))?$/.test(
      await stdout(options.runCommand, psqlBin, ['--version'])
    )
  ) {
    mismatch('psql');
  }
  return { nodeMajor: 24, psqlBin, serverVersionNum: 170006 };
}
