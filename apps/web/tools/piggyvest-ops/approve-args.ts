import {
  type OpsApproveArgs,
  opsApproveArgsSchema,
} from '@/schemas/piggyvest/ops-approvals';

export type ParsedApproveArgs =
  | { ok: true; help: true }
  | { ok: true; args: OpsApproveArgs }
  | { ok: false; error: string };

export const PASSWORD_REFUSAL =
  'Passwords are never accepted on the command line. You will be asked for yours at a hidden prompt.';

const VALUE_FLAGS = {
  '--host': 'host',
  '--port': 'port',
  '--database': 'database',
  '--user': 'user',
  '--request': 'request',
  '--ca': 'caFile',
} as const;

const SWITCH_FLAGS = {
  '--reject': 'reject',
  '--commit': 'commit',
} as const;

// Anything that looks like a secret or a connection string is refused
// outright, before any prompt or connection, so it is never used. The one
// exception is the --ca file path, which is read as a certificate only.
const SECRET_LIKE = /pass|pwd|secret|token|:\/\/|@/i;

function isValueFlag(flag: string): flag is keyof typeof VALUE_FLAGS {
  return Object.hasOwn(VALUE_FLAGS, flag);
}

function isSwitchFlag(flag: string): flag is keyof typeof SWITCH_FLAGS {
  return Object.hasOwn(SWITCH_FLAGS, flag);
}

export function parseApproveArgs(argv: readonly string[]): ParsedApproveArgs {
  if (
    argv.some(
      (token, index) => argv[index - 1] !== '--ca' && SECRET_LIKE.test(token)
    )
  ) {
    return { ok: false, error: PASSWORD_REFUSAL };
  }
  if (argv.length === 1 && argv[0] === '--help')
    return { ok: true, help: true };

  const values: Record<string, string> = {};
  const switches = { reject: false, commit: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (isSwitchFlag(token)) {
      switches[SWITCH_FLAGS[token]] = true;
      continue;
    }
    if (!isValueFlag(token)) {
      return { ok: false, error: `Unknown argument: ${token}` };
    }
    const key = VALUE_FLAGS[token];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, error: `${token} needs a value` };
    }
    if (Object.hasOwn(values, key)) {
      return { ok: false, error: `${token} was given twice` };
    }
    values[key] = value;
    index += 1;
  }

  const port = values.port ?? '5432';
  const parsed = opsApproveArgsSchema.safeParse({
    host: values.host,
    port: /^[0-9]{1,5}$/.test(port) ? Number(port) : Number.NaN,
    database: values.database ?? 'postgres',
    user: values.user,
    ...(values.request === undefined ? {} : { request: values.request }),
    ...(values.caFile === undefined ? {} : { caFile: values.caFile }),
    reject: switches.reject,
    commit: switches.commit,
    help: false,
  });
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join('.') || issue.message)
      .join(', ');
    return { ok: false, error: `Invalid arguments: ${fields}` };
  }
  return { ok: true, args: parsed.data };
}
