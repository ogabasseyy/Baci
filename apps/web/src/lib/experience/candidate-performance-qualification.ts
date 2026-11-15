import { createHash } from 'node:crypto';
import {
  type ExperiencePerformanceReport,
  experiencePerformanceReport,
} from '@/schemas/experience-performance';
import { experienceCanonicalRoutePathSchema } from '@/schemas/experience-route-path';

export const EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY = {
  id: 'chromium-native-reference/v1',
  widths: [390, 1440],
  coldSamplesPerCell: 3,
  lcpTargetMs: 2000,
  maxCls: 0.1,
} as const;

export type CandidatePerformanceQualificationReason =
  | 'invalid-report'
  | 'binding-mismatch'
  | 'data-binding-mismatch'
  | 'renderer-mismatch'
  | 'contaminated'
  | 'route-matrix-mismatch'
  | 'missing-metrics'
  | 'content-not-ready'
  | 'lcp-threshold'
  | 'cls-threshold';

export class CandidatePerformanceQualificationError extends Error {
  readonly code = 'PERFORMANCE_NOT_QUALIFIED';

  constructor(readonly reason: CandidatePerformanceQualificationReason) {
    super(`PERFORMANCE_NOT_QUALIFIED:${reason}`);
    this.name = 'CandidatePerformanceQualificationError';
  }
}

export interface CandidatePerformanceExpectation {
  buildDigest: string;
  sourceDigest: string;
  renderer: 'client' | 'prerender';
  routes: readonly string[];
  bootstrapDigests: readonly { route: string; digest: string }[];
}

export interface CandidatePerformanceQualification {
  policyId: typeof EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY.id;
  buildDigest: string;
  sourceDigest: string;
  reportDigest: string;
  routeCount: number;
  sampleCount: number;
  cwvQualified: false;
  releaseQualified: false;
  report: ExperiencePerformanceReport;
}

function reject(reason: CandidatePerformanceQualificationReason): never {
  throw new CandidatePerformanceQualificationError(reason);
}

function metric(value: number | null): number {
  if (value === null) reject('missing-metrics');
  return value;
}

/** Validates reports produced by the trusted local runner, never candidate claims. */
export function assertCandidatePerformanceQualification(
  input: unknown,
  expected: CandidatePerformanceExpectation
): CandidatePerformanceQualification {
  if (!expected || typeof expected !== 'object') reject('invalid-report');
  const parsed = experiencePerformanceReport.safeParse(input);
  if (!parsed.success) reject('invalid-report');
  const report = parsed.data;
  if (
    !/^[a-f0-9]{64}$/.test(expected.buildDigest) ||
    !/^[a-f0-9]{64}$/.test(expected.sourceDigest) ||
    report.buildDigest !== expected.buildDigest ||
    report.sourceDigest !== expected.sourceDigest
  )
    reject('binding-mismatch');
  if (report.renderer !== expected.renderer) reject('renderer-mismatch');
  if (report.contaminated) reject('contaminated');

  const policy = EXPERIENCE_PERFORMANCE_QUALIFICATION_POLICY;
  if (!Array.isArray(expected.routes)) reject('route-matrix-mismatch');
  const routes = [...expected.routes];
  if (
    routes.length === 0 ||
    routes.length * policy.widths.length * policy.coldSamplesPerCell > 96 ||
    routes.some(
      (route) => !experienceCanonicalRoutePathSchema.safeParse(route).success
    ) ||
    new Set(routes).size !== routes.length
  )
    reject('route-matrix-mismatch');

  const groups = new Map<string, ExperiencePerformanceReport['samples']>();
  for (const sample of report.samples) {
    const key = `${sample.route}\0${sample.width}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  if (
    report.samples.length !==
      routes.length * policy.widths.length * policy.coldSamplesPerCell ||
    groups.size !== routes.length * policy.widths.length ||
    [...groups.keys()].some((key) => {
      const [route, width] = key.split('\0');
      return (
        !routes.includes(route) ||
        !policy.widths.includes(Number(width) as 390 | 1440) ||
        groups.get(key)?.length !== policy.coldSamplesPerCell
      );
    })
  )
    reject('route-matrix-mismatch');

  const expectedDigests = expected.bootstrapDigests;
  const reportDigests = report.bootstrapDigests;
  if (
    !Array.isArray(expectedDigests) ||
    !Array.isArray(reportDigests) ||
    expectedDigests.length !== routes.length ||
    reportDigests.length !== routes.length ||
    [...expectedDigests, ...reportDigests].some(
      ({ route, digest }) =>
        typeof route !== 'string' ||
        !/^[a-f0-9]{64}$/.test(digest) ||
        !routes.includes(route)
    ) ||
    new Set(expectedDigests.map(({ route }) => route)).size !== routes.length ||
    new Set(reportDigests.map(({ route }) => route)).size !== routes.length ||
    routes.some((route) => {
      const expectedDigest = expectedDigests.find(
        (entry) => entry.route === route
      )?.digest;
      const actualDigest = reportDigests.find(
        (entry) => entry.route === route
      )?.digest;
      return !expectedDigest || actualDigest !== expectedDigest;
    })
  )
    reject('data-binding-mismatch');

  for (const samples of groups.values()) {
    if (
      samples.some(
        (sample) =>
          sample.frameLcpMs === null ||
          sample.hostLcpMs === null ||
          sample.frameCls === null ||
          sample.hostCls === null
      )
    )
      reject('missing-metrics');
    if (
      samples.some(
        (sample) =>
          !sample.contentVisible ||
          !sample.imagesDecoded ||
          sample.consoleErrors > 0
      )
    )
      reject('content-not-ready');
    if (
      samples.some(
        (sample) =>
          metric(sample.frameCls) > policy.maxCls ||
          metric(sample.hostCls) > policy.maxCls
      )
    )
      reject('cls-threshold');
    const frameLcpValues = samples
      .map((sample) => metric(sample.frameLcpMs))
      .sort((a, b) => a - b);
    const hostLcpValues = samples
      .map((sample) => metric(sample.hostLcpMs))
      .sort((a, b) => a - b);
    const frameLcp = frameLcpValues[1];
    const hostLcp = hostLcpValues[1];
    if (frameLcp === undefined || hostLcp === undefined)
      reject('missing-metrics');
    if (frameLcp > policy.lcpTargetMs || hostLcp > policy.lcpTargetMs)
      reject('lcp-threshold');
  }

  const reportDigest = createHash('sha256')
    .update(JSON.stringify(report))
    .digest('hex');
  return {
    policyId: policy.id,
    buildDigest: report.buildDigest,
    sourceDigest: report.sourceDigest,
    reportDigest,
    routeCount: routes.length,
    sampleCount: report.samples.length,
    cwvQualified: false,
    releaseQualified: false,
    report,
  };
}
