export class VerifierTemporarilyUnavailable extends Error {
  constructor() {
    super('VERIFIER_UNAVAILABLE');
  }
}
