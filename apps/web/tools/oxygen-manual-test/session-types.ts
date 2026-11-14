import type { ProbeCheckpoint } from './checkpoint';
import type { EligibilityReport } from './eligibility-report';
import type { ProbeRecovery } from './recovery';

export interface ProbeConfig {
  baseUrl: string;
  environment: 'dev' | 'staging' | 'production';
  resumeRejectedCreate?: boolean;
  resumeState?: unknown;
  checkpoint?: unknown;
  persistCheckpoint?: (state: ProbeCheckpoint) => Promise<void>;
  reference: string;
  secret: string;
}
export interface ProbeResult {
  code: string;
  diagnostic?: string;
  kyc?: ProbeRecovery['kyc'];
  accountName?: string;
  banks?: { name: string; code: string }[];
  customerPath?: 'existing' | 'new' | 'unknown';
  shape?: unknown;
  decision?: unknown;
  eligibilityReport?: EligibilityReport;
  status?: number;
  url?: string;
}
