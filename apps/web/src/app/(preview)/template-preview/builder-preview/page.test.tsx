import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./builder-preview-canvas', () => ({
  BuilderPreviewCanvas: () => (
    <output data-testid="builder-preview-route-canvas">Preview canvas</output>
  ),
}));

const { default: BuilderPreviewPage, metadata } = await import('./page');

describe('BuilderPreviewPage', () => {
  it('renders the isolated preview canvas and blocks indexing', () => {
    render(<BuilderPreviewPage />);

    expect(
      screen.getByTestId('builder-preview-route-canvas')
    ).toHaveTextContent('Preview canvas');
    expect(metadata.robots).toEqual({ follow: false, index: false });
  });
});
