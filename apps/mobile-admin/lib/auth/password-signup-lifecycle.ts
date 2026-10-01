import {
  captureMobileSignupLifecycle,
  type MobileSignupLifecycleInput,
  type SignupFlow,
  type SignupOutcome,
} from '@/services/signup-lifecycle-telemetry';

type PasswordSignupLifecycleDetails = Omit<
  MobileSignupLifecycleInput,
  'attemptId' | 'durationMs' | 'eventCode' | 'flow' | 'outcome' | 'stage'
>;

interface PasswordSignupLifecycleContext {
  attemptId: string;
  flow: SignupFlow;
  startedAt: number;
}

export function createPasswordSignupLifecycle({
  attemptId,
  flow,
  startedAt,
}: PasswordSignupLifecycleContext) {
  return (
    eventCode: string,
    outcome: SignupOutcome,
    details: PasswordSignupLifecycleDetails = {}
  ): void => {
    void captureMobileSignupLifecycle({
      ...details,
      attemptId,
      durationMs: Date.now() - startedAt,
      eventCode,
      flow,
      outcome,
      stage: 'auth',
    });
  };
}
