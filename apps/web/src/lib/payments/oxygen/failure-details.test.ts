import { expect, it } from 'vitest';
import { oxygenFailureDetails } from './failure-details';

it('retains bounded redacted messages only from supported error fields', () => {
  const result = oxygenFailureDetails(
    {
      details: [
        'failed token-secret',
        'failed token-secret',
        { unknown: 'do-not-copy', message: 'x'.repeat(500) },
      ],
    },
    {},
    ['token-secret']
  );
  expect(result).toHaveLength(2);
  expect(result[0]).not.toContain('token-secret');
  expect(result[1].length).toBeLessThanOrEqual(384);
  expect(JSON.stringify(result)).not.toContain('do-not-copy');
  expect(oxygenFailureDetails({ arbitrary: 'ignored' }, {}, [])).toEqual([]);
});
