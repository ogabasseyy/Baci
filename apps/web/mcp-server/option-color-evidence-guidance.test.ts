import { describe, expect, it } from 'vitest';
import { MCP_OPTION_COLOR_EVIDENCE_GUIDANCE } from './option-color-evidence-guidance';

describe('MCP selectable color evidence guidance', () => {
  it('separates catalog color labels from variant selectable color evidence', () => {
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('explicitly stored product `color` or `color_images` labels');
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('`attributes.color`, `attributes.Colour`, or `attributes.colour`');
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).not.toContain('`Color`');
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('do not establish stock');
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('infer a color-and-stock combination');
  });

  it('does not treat product images or image filenames as selectable color evidence', () => {
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('Product-level images and image filenames are illustrative');
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('report the stored catalog color separately');
    expect(MCP_OPTION_COLOR_EVIDENCE_GUIDANCE).toContain('If no catalog or variant color is returned, color is unconfirmed; do not guess.');
  });
});
