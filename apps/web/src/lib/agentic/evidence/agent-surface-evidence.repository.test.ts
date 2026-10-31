// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { validateAgentSurfaceEvidence } from './agent-surface-evidence';
import { formatSurfaceEvidenceErrors } from './format-agent-surface-evidence-errors';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../..'
);

it('keeps the access map surface evidence table complete and unambiguous', () => {
  const markdown = readFileSync(
    join(repoRoot, 'docs/product/agent-access-map.md'),
    'utf8'
  );

  const result = validateAgentSurfaceEvidence(markdown);

  expect(result.ok ? [] : formatSurfaceEvidenceErrors(result.errors)).toEqual(
    []
  );
});
