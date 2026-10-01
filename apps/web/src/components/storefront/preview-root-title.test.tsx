import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewRootTitle } from './preview-root-title';

describe('PreviewRootTitle', () => {
  it('renders the root title as inert preview-only context', () => {
    render(<PreviewRootTitle title="Summer shop" />);

    expect(screen.getByTestId('builder-preview-root-title')).toHaveAttribute(
      'aria-label',
      'Preview page title'
    );
    expect(screen.getByTestId('builder-preview-root-title')).toHaveTextContent(
      'Page title · Summer shop'
    );
  });
});
