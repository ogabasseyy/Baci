import { expect, it } from 'vitest';
import { parseReplaySummary } from './replay-summary';

const summary = {
  replay: 'staging-pass-complete',
  claimed: 2,
  processed: 0,
  quarantined: 2,
  retryable: 0,
  resolutionFailures: 0,
};
it('preserves counts for an all-quarantined batch', () => {
  expect(parseReplaySummary(JSON.stringify(summary))).toEqual(summary);
});
it.each([
  'secret payload',
  JSON.stringify({ ...summary, body: 'secret' }),
  JSON.stringify({ ...summary, claimed: 0 }),
])('refuses unexpected child output without surfacing it', (raw) => {
  expect(() => parseReplaySummary(raw)).toThrow(
    'Staging replay summary refused'
  );
});
