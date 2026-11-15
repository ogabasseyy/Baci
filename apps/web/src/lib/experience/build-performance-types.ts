import type { ExperienceManifest } from '@baci/shared/experience';
import type { ExperiencePerformanceReport } from '@/schemas/experience-performance';
import type { loadOfflineAssets } from './asset-service';
import type { OwnerRequestContext } from './authorization';
import type { verifyCompiledCandidate } from './build-service';

export interface BuildPerformanceDependencies {
  performanceMeasurement?: (input: {
    ctx: OwnerRequestContext;
    manifest: ExperienceManifest;
    candidate: ReturnType<typeof verifyCompiledCandidate>;
    renderer: ReturnType<typeof verifyCompiledCandidate>;
    rendererKind: 'client' | 'prerender';
    assets: Awaited<ReturnType<typeof loadOfflineAssets>>;
    sourceDigest: string;
  }) => Promise<{
    status: 'measured' | 'failed' | 'not-measured';
    report?: ExperiencePerformanceReport;
    jobIds: string[];
  }>;
  performanceReports?: {
    retain(
      binding: {
        merchantId: string;
        buildId: string;
        buildDigest: string;
        sourceDigest: string;
      },
      report: unknown
    ): void;
  };
}
