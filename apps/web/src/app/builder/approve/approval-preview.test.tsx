import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { PreviewResult } from '@/schemas/builder-mcp-results';
import { ApprovalPreview } from './approval-preview';

vi.mock('@/components/storefront/preview-renderer-core', () => ({
  PreviewRendererCore: () => {
    throw new Error('unsupported render');
  },
}));
it('removes the publication action when the bound preview cannot render', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(
      <ApprovalPreview
        preview={
          { storefrontId: 'fixture', version: 'draft:fixture' } as PreviewResult
        }
      >
        <button type="button">Publish approved homepage</button>
      </ApprovalPreview>
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'could not be displayed'
    );
    expect(
      screen.queryByRole('button', { name: 'Publish approved homepage' })
    ).not.toBeInTheDocument();
  } finally {
    consoleError.mockRestore();
  }
});
