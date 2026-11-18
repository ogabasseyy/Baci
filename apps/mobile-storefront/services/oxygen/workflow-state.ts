import type { OxygenRuntimeSnapshot } from '@baci/shared/oxygen';
import type { OxygenClientError } from './errors';
export interface OxygenApprovalBinding {
  version: number;
  bookingReference: string;
}
export interface OxygenWorkflowState {
  snapshot: OxygenRuntimeSnapshot | null;
  busy: boolean;
  capabilitiesVerified: boolean;
  error: OxygenClientError | null;
}
