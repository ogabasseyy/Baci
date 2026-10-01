import { expect, it } from 'vitest';
import { eventPipelineBoundaryManifest } from './event-pipeline-boundary-manifest';

it('keeps onboarding auth-client authority separate from admin authority', () => {
  const onboardingActions = 'apps/web/src/app/(platform)/onboarding/actions.ts';
  const onboardingWorkflow =
    'apps/web/src/app/(platform)/onboarding/submit-onboarding-workflow.ts';

  expect(eventPipelineBoundaryManifest.authority.adminImporters).not.toContain(
    onboardingActions
  );
  expect(eventPipelineBoundaryManifest.authority.serverImporters).toContain(
    onboardingActions
  );
  expect(eventPipelineBoundaryManifest.authority.credentialPaths).toEqual(
    expect.arrayContaining([
      [onboardingActions, onboardingWorkflow, 'apps/web/src/env.ts'],
      [onboardingWorkflow, 'apps/web/src/env.ts'],
    ])
  );
  expect(eventPipelineBoundaryManifest.frozenAuthoritySources).toEqual({
    [onboardingActions]:
      'ad902de74546a2ab71e1847b25076a3a3d6df711d0d5ea6229796bfe9bbb94d5',
    'apps/web/src/lib/agentic/jwt-signing-material.ts':
      '80d2271351155737a6f247671f8e0b428d7b20285df3db203235c49288c04d92',
  });
});
