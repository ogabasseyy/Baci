import { describe, expect, it } from 'vitest';
import { isNonAgenticWorkerProfile } from './is-non-agentic-worker-profile';

describe('isNonAgenticWorkerProfile', () => {
  it.each([
    'ai-storefront-jobs',
    'event-pipeline',
    'gigl-tracking',
    'petrock-reconciliation',
    'quiz-finalization',
  ])('allows the bounded %s worker without agentic signing material', (profile) => {
    expect(isNonAgenticWorkerProfile(profile)).toBe(true);
  });

  it('does not exempt unknown production processes', () => {
    expect(isNonAgenticWorkerProfile('unknown-worker')).toBe(false);
    expect(isNonAgenticWorkerProfile(undefined)).toBe(false);
  });
});
