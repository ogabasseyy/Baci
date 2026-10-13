import { acceptanceContract } from '../constants.mjs';

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

function safePath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith('tools/staging/') &&
    /^[a-zA-Z0-9_./-]+$/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..') &&
    !value.split('/').some((part) => part.startsWith('.'))
  );
}

export const acceptanceSchema = Object.freeze({
  parse(input) {
    exactObject(input, ['schemaVersion', 'mode', 'evidence'], 'report input');
    if (input.schemaVersion !== 1)
      throw new Error('Unsupported schema version');
    if (input.mode !== undefined && input.mode !== 'read-only') {
      throw new Error('Only read-only reporting is supported');
    }
    if (!Array.isArray(input.evidence))
      throw new Error('Evidence must be an array');
    const ids = new Set();
    const evidence = input.evidence.map((entry) => {
      exactObject(
        entry,
        ['id', 'category', 'kind', 'path', 'sha256'],
        'evidence'
      );
      if (
        typeof entry.id !== 'string' ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(entry.id) ||
        ids.has(entry.id)
      ) {
        throw new Error('Invalid or duplicate evidence ID');
      }
      ids.add(entry.id);
      if (
        typeof entry.category !== 'string' ||
        !Object.hasOwn(acceptanceContract.categories, entry.category) ||
        acceptanceContract.categories[entry.category] !== entry.kind
      ) {
        throw new Error('Evidence kind cannot establish this category');
      }
      if (
        !safePath(entry.path) ||
        typeof entry.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      ) {
        throw new Error(
          'Evidence requires a safe local path and SHA-256 digest'
        );
      }
      return { ...entry };
    });
    return { schemaVersion: 1, mode: 'read-only', evidence };
  },
});
