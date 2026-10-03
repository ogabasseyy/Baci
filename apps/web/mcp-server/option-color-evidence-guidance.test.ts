import { describe, expect, it } from 'vitest';
import { MCP_OPTION_COLOR_EVIDENCE_GUIDANCE } from './option-color-evidence-guidance';

describe('MCP selectable color evidence guidance', () => {
  it('names only color axis keys supported by the storefront variant resolver', () => {
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('`attributes.color`, `attributes.Colour`, or `attributes.colour`');
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).not.toContain('`Color`');
  });

  it('does not treat product images or image filenames as selectable color evidence', () => {
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('Product-level images and image filenames are illustrative');
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('If no color value is returned, say color is unconfirmed; do not guess.');
  });
});
