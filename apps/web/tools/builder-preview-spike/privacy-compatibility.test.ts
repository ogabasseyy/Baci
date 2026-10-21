// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface ProbeReport {
  scope: string;
  decision: string;
  records: { name: string; result: string }[];
}

describe.skipIf(process.env.BACI_BUILDER_DATABASE_PROBE !== '1')(
  'Task 0 disposable raw Data API characterization',
  () => {
    it('preserves an existing newer private revision during cutover', () => {
      const output = execFileSync(
        process.execPath,
        ['tools/builder-preview-spike/privacy-probe.mjs'],
        {
          encoding: 'utf8',
          timeout: 60_000,
          env: { ...process.env, BACI_BUILDER_NEWER_PRIVATE: '1' },
        }
      );
      const report = JSON.parse(output) as ProbeReport;
      expect(report.records).toContainEqual({
        name: 'cutover preserves a newer existing private draft',
        result: 'PASS',
      });
    }, 65_000);
    it('proves isolated private lifecycle contracts and keeps legacy activation gated', () => {
      const output = execFileSync(
        process.execPath,
        ['tools/builder-preview-spike/privacy-probe.mjs'],
        { encoding: 'utf8', timeout: 60_000 }
      );
      const report = JSON.parse(output) as ProbeReport;
      expect(report.scope).toContain('NOT full migration');
      expect(report.decision).toBe('NO-GO');
      expect(report.records.length).toBeGreaterThanOrEqual(26);
      expect(report.records.map((record) => record.name)).toContain(
        'native AI apply preserves public content, checks CAS and marks exactly once under RLS'
      );
      expect(report.records.every((record) => record.result === 'PASS')).toBe(
        true
      );
      expect(report.records.at(-1)?.name).toBe(
        'legacy draft query is incompatible after removing public copies'
      );
    }, 65_000);
  }
);
