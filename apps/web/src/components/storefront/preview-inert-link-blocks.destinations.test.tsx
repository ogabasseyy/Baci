import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { previewInertLinkBlocks } from './preview-inert-link-blocks';

describe('preview inert link destinations', () => {
  it('shows accepted Button and carousel CTA destinations without anchors', () => {
    const fetchSpy = vi.spyOn(window, 'fetch');
    render(
      <>
        {previewInertLinkBlocks.Button.render({
          link: '/collections/new',
          text: 'Shop new arrivals',
        })}
        {previewInertLinkBlocks.HeroCarousel.render({
          slides: [
            {
              ctaLink: '/collections/featured',
              ctaText: 'Shop featured',
              title: 'Featured',
            },
            {
              ctaLink: '/collections/sale',
              ctaText: 'Shop sale',
              title: 'Sale',
            },
          ],
        })}
      </>
    );

    expect(
      screen.getByLabelText('Preview button destination')
    ).toHaveTextContent('/collections/new');
    expect(
      screen.getByLabelText('Preview carousel slide 1 CTA destination')
    ).toHaveTextContent('/collections/featured');
    expect(
      screen.getByLabelText('Preview carousel slide 2 CTA destination')
    ).toHaveTextContent('/collections/sale');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Shop new arrivals' })
    ).toBeDisabled();
    fetchSpy.mockRestore();
  });
});
