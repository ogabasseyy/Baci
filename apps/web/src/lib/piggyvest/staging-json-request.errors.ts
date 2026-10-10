export type PiggyvestStagingJsonRequestErrorCode =
  | 'BODY_READ_ERROR'
  | 'HTTP_STATUS'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'RESPONSE_TOO_LARGE'
  | 'TIMEOUT';

export class PiggyvestStagingJsonRequestError extends Error {
  constructor(readonly code: PiggyvestStagingJsonRequestErrorCode) {
    super(`PiggyVest staging request failed: ${code}.`);
    this.name = 'PiggyvestStagingJsonRequestError';
  }
}
