/** A refusal raised by the approval functions (e.g. ops_approval_expired). */
export class OpsRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OpsRefusal';
  }
}
