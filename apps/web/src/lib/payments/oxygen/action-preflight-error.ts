import { oxygenActionNotDispatchedCode } from '@baci/shared/oxygen';

/** Only use before attempting to enqueue the command. */
export class OxygenActionPreflightError extends Error {
  readonly code = oxygenActionNotDispatchedCode;

  constructor() {
    super(
      'Unable to confirm this step. Refresh the saved status before continuing.'
    );
  }
}
