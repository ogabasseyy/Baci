import { expect, it } from 'vitest';
import { boundedPsqlDiagnostic } from './psql-replay-diagnostic';

it('extracts only SQLSTATE from the anonymous draft wrapper, never private text', () => {
  expect(
    boundedPsqlDiagnostic('psql', [
      Buffer.from(
        'psql:/owned/secret.sql:88: ERROR:  anonymous draft save unexpected SQLSTATE 42883\nprivate-token=secret'
      ),
    ])
  ).toBe(' (line=88,sqlstate=42883)');
});
