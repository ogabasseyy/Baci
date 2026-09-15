/** Parse explicit options; missing values fail before any Docker invocation. */
export function parseArgs(argv) {
  const result = { dryRun: false };
  const fields = {
    '--profile': ['profiles', (value) => value.split(',')],
    '--family': ['families', (value) => value.split(',')],
    '--output': ['outputFolder', String],
    '--base-url': ['baseUrl', String],
    '--max-runs': ['maxRuns', Number],
    '--min-free-gib': ['minFreeGiB', Number],
    '--build-id': ['buildId', String],
    '--samples': ['samples', Number],
    '--matrix': ['matrixFile', String],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--dry-run') {
      result.dryRun = true;
      continue;
    }
    const field = fields[option];
    if (!field) throw new Error(`unknown option ${option}`);
    const value = argv[++index];
    if (!value || value.startsWith('--'))
      throw new Error(`missing value for ${option}`);
    result[field[0]] = field[1](value);
  }
  return result;
}
