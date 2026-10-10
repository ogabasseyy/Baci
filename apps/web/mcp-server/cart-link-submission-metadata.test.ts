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
  it('keeps justification entries for the tool and its compatibility alias', () => {
    const submission: { tools: Record<string, SubmissionTool> } = JSON.parse(
      readFileSync(
        new URL('../../../chatgpt-app-submission.json', import.meta.url),
        'utf8'
      )
    );
    // The runtime still registers add_to_cart alongside the renamed tool,
    // so the submission must justify both: the production scan discovers
    // every registered tool, not just the current name.
    for (const name of ['prepare_storefront_cart_link', 'add_to_cart']) {
      expect(submission.tools[name].annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      });
      expect(
        submission.tools[name].justifications.read_only_justification
      ).toMatch(/handoff URL/);
    }
    expect(
      submission.tools.add_to_cart.justifications.read_only_justification
    ).toMatch(/alias of prepare_storefront_cart_link/);
  });
});
