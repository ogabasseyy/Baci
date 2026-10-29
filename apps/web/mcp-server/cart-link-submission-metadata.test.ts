// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type SubmissionTool = {
  annotations: {
    readOnlyHint: boolean;
    openWorldHint: boolean;
    destructiveHint: boolean;
  };
  justifications: Record<string, string>;
};

describe('published cart-link submission metadata', () => {
  it('justifies the link-only tool without advertising the retired alias', () => {
    const submission: { tools: Record<string, SubmissionTool> } = JSON.parse(
      readFileSync(
        new URL('../../../chatgpt-app-submission.json', import.meta.url),
        'utf8'
      )
    );
    const linkTool = submission.tools.prepare_storefront_cart_link;
    expect(linkTool.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
    expect(
      linkTool.justifications.read_only_justification
    ).toMatch(/handoff URL/);
    expect(submission.tools).not.toHaveProperty('add_to_cart');
  });
});
