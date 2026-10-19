import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewInertFooter } from './preview-inert-footer';

describe('PreviewInertFooter', () => {
  it('matches the published layout while keeping footer actions inert', () => {
    render(
      <PreviewInertFooter
        quickLinks={[{ label: 'Contact' }]}
        showNewsletter
        socialLinks={{ instagram: 'https://instagram.com/store' }}
      />
    );

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveClass('mt-auto', 'py-12');
    expect(footer.firstElementChild).toHaveClass(
      'container',
      'mx-auto',
      'px-4'
    );
    expect(footer.firstElementChild?.firstElementChild).toHaveClass(
      'grid',
      'gap-8',
      'sm:grid-cols-2',
      'lg:grid-cols-4'
    );
    expect(screen.getByRole('button', { name: 'Contact' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'instagram' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeDisabled();
  });

  it('shows each saved quick-link destination without creating navigation', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    render(
      <PreviewInertFooter
        quickLinks={[
          { label: 'Contact', url: '/contact' },
          { label: 'Shipping', url: '/shipping' },
        ]}
      />
    );

    expect(
      screen.getByLabelText('Preview footer link Contact destination')
    ).toHaveTextContent('/contact');
    expect(
      screen.getByLabelText('Preview footer link Shipping destination')
    ).toHaveTextContent('/shipping');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
