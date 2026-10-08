export class PilotCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotCliError';
  }
}

// Allowed defaults to required: a misspelled safety flag (e.g.
// --min-free-byte) must abort, never silently fall back to a default
// while the operator believes the floor holds. Callers with genuine
// optionals pass an explicit superset.
export function parseCliArgs(argv, required = [], allowed = required) {
  const allowedKeys = new Set(allowed);
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new PilotCliError(`unexpected argument "${token}"`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new PilotCliError(`missing value for "${token}"`);
    }
    if (Object.hasOwn(args, key)) {
      throw new PilotCliError(`duplicate flag "--${key}"`);
    }
    if (!allowedKeys.has(key)) {
      throw new PilotCliError(
        `unknown flag "--${key}" (expected ${[...allowedKeys].map((name) => `"--${name}"`).join(', ') || 'no flags'})`
      );
    }
    args[key] = value;
    index += 1;
  }
  for (const key of required) {
    if (!args[key]) {
      throw new PilotCliError(`missing required --${key}`);
    }
  }
  return args;
}
