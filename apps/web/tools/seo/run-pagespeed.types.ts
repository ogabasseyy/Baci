export type PageSpeedStrategy = 'mobile' | 'desktop';

export interface PageSpeedTarget {
  label: string;
  url: string;
}

export interface PageSpeedFailure {
  metric: string;
  actual: number | null;
  threshold: number;
  message?: string;
}

export interface PageSpeedAuditResult {
  label: string;
  url: string;
  strategy: PageSpeedStrategy;
  passed: boolean;
  failures: PageSpeedFailure[];
  scores: Record<string, number | null>;
  vitals: Record<string, number | null>;
}

export interface PageSpeedApiResponse {
  lighthouseResult?: {
    runtimeError?: { code?: string };
    categories?: Record<
      string,
      { score?: number | null; auditRefs?: { id: string; weight: number }[] }
    >;
    audits?: Record<
      string,
      { numericValue?: number | null; score?: number | null }
    >;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number | null }>;
  };
  originLoadingExperience?: {
    metrics?: Record<string, { percentile?: number | null }>;
  };
}
