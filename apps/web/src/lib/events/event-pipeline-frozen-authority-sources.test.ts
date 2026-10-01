import { expect, it } from 'vitest';
import { frozenEventPipelineAuthoritySources } from './event-pipeline-frozen-authority-sources';

it('freezes the reviewed inherited authority sources', () => {
  const onboardingActions = 'apps/web/src/app/(platform)/onboarding/actions.ts';
  const jwtSigningMaterial = 'apps/web/src/lib/agentic/jwt-signing-material.ts';

  expect(frozenEventPipelineAuthoritySources).toEqual({
    [onboardingActions]:
      'ad902de74546a2ab71e1847b25076a3a3d6df711d0d5ea6229796bfe9bbb94d5',
    [jwtSigningMaterial]:
      '80d2271351155737a6f247671f8e0b428d7b20285df3db203235c49288c04d92',
  });
  expect(Object.values(frozenEventPipelineAuthoritySources)).toEqual([
    expect.stringMatching(/^[a-f0-9]{64}$/),
    expect.stringMatching(/^[a-f0-9]{64}$/),
  ]);
});
