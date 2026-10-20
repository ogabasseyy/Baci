import { describe, expect, it } from 'vitest';
import { draftClosureReviewFixture } from './piggyvest-draft-closure';

describe('draftClosureReviewFixture', () => {
  it('closes through the controller and counts close calls', async () => {
    const fixture = await draftClosureReviewFixture();
    expect(fixture.binding.read(fixture.source)?.status).toBe('review');
    await fixture.binding.close(true, fixture.binding.getSnapshot());
    expect(fixture.calls()).toBe(1);
    expect(fixture.binding.read(fixture.source)?.status).toBe('closed');
  });

  it('surfaces response loss as an unavailable close', async () => {
    const fixture = await draftClosureReviewFixture();
    fixture.loseResponse();
    await expect(
      fixture.binding.close(true, fixture.binding.getSnapshot())
    ).rejects.toThrow('Plan closure unavailable');
    expect(fixture.calls()).toBe(1);
  });
});
