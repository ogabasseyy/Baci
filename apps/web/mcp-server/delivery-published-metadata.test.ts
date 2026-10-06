// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('published delivery submission metadata', () => {
  it('declares external read-only quoting and conditional numeric estimates', () => {
    const submission: { tools: Record<string, { annotations: { openWorldHint: boolean; readOnlyHint: boolean } }> } = JSON.parse(readFileSync(new URL('../../../chatgpt-app-submission.json', import.meta.url), 'utf8'));
    const text = JSON.stringify(submission);
    expect(text).toContain('external GIG carrier');
    expect(text).toContain('confirmed per-unit');
    expect(text).not.toContain('does not publish a fixed fee or numeric quote');
    expect(submission.tools.get_delivery_fee_info.annotations).toMatchObject({ openWorldHint: true, readOnlyHint: true });
  });
});
