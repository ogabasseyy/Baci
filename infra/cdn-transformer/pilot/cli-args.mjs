export class PilotCliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotCliError';
  }
}

export function parseCliArgs(argv, required = []) {
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
