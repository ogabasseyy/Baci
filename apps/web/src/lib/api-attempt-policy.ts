export type AttemptAdmission<Code extends string> =
  | { allowed: true }
  | { allowed: false; code: Code };
export interface AttemptPolicy<Code extends string> {
  beforeAttempt(): AttemptAdmission<Code>;
  onAttemptStart(): void;
}
export class AttemptAdmissionDenied<
  Code extends string = string,
> extends Error {
  constructor(
    readonly code: Code,
    readonly attempted: boolean,
    readonly priorOutcome: 'none' | 'csrf-rejected'
  ) {
    super('Request admission denied');
  }
}
