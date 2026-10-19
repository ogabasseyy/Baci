import { expect, it } from 'vitest';
import { buildImportEntries } from './build-import-entries';

it('builds one silent import replacement intent with the original base-version fence and receipt', () => {
  const replacement = {
    expectedVersion: 4,
    operationId: 'stable',
    lines: [{ item: { productId: 'p' }, quantity: 1 }],
  };
  expect(
    buildImportEntries(
      {
        kind: 'commands',
        adds: [],
        sets: [],
        assurances: [],
        warnings: [],
        replacement,
      },
      'cart'
    )
  ).toEqual([
    {
      operationId: 'stable',
      intent: { kind: 'replace', lines: replacement.lines, expectedVersion: 4 },
    },
  ]);
});
