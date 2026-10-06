import { describe, expect, it } from 'vitest';
import { getHostedDraftStandaloneOutput } from './hosted-draft-standalone-output';

describe('getHostedDraftStandaloneOutput', () => {
  it('enables standalone output only on the explicit true marker', () => {
    expect(
      getHostedDraftStandaloneOutput({
        PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD: 'true',
      })
    ).toEqual({ output: 'standalone' });
    expect(getHostedDraftStandaloneOutput({})).toEqual({});
    expect(
      getHostedDraftStandaloneOutput({
        PIGGYVEST_HOSTED_DRAFT_STANDALONE_BUILD: '1',
      })
    ).toEqual({});
  });
});
