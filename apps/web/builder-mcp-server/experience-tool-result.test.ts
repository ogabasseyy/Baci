import { expect, it } from 'vitest';
import { experienceMcpToolResult } from './experience-tool-result';

it('preserves the validated budget error in both MCP result representations', async () => {
  const failure = {
    status: 'error',
    code: 'PERFORMANCE_BUDGET_EXCEEDED',
    resource: 'javascript',
    error: 'Experience request unavailable.',
  };
  const result = await experienceMcpToolResult(
    'finalize_experience_build',
    failure
  );
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual(failure);
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify(failure) },
  ]);
});

it('rejects an unrecognized budget resource before either MCP representation', async () => {
  const result = await experienceMcpToolResult('finalize_experience_build', {
    status: 'error',
    code: 'PERFORMANCE_BUDGET_EXCEEDED',
    resource: 'private-source-secret',
    error: 'Experience request unavailable.',
  });
  expect(result.structuredContent).toEqual({
    status: 'error',
    code: 'UNAVAILABLE',
    error: 'Experience request unavailable.',
  });
  expect(JSON.stringify(result)).not.toContain('private-source-secret');
});
