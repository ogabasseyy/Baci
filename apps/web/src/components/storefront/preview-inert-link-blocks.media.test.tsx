import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { previewInertLinkBlocks } from './preview-inert-link-blocks';

describe('preview inert block media and placeholders', () => {
  it('renders refused saved sections as bounded inert placeholders', () => {
    render(
      previewInertLinkBlocks.PreviewPlaceholder.render({
        label: 'CodeEmbed section',
      })
    );

    expect(
      screen.getByRole('region', {
        name: 'CodeEmbed section preview placeholder',
      })
    ).toHaveTextContent('CodeEmbed section');
  });

  it('renders validated Hero gradients and projected carousel image fixtures', () => {
    render(
      <>
        {previewInertLinkBlocks.Hero.render({
          backgroundGradient: 'linear-gradient(#123456, #654321)',
          title: 'Gradient hero',
        })}
        {previewInertLinkBlocks.HeroCarousel.render({
          slides: [{ image: '/placeholder.png', title: 'Slide one' }],
        })}
      </>
    );

    expect(screen.getByRole('region', { name: 'Preview hero' })).toHaveStyle({
      backgroundImage: 'linear-gradient(#123456, #654321)',
    });
    expect(screen.getByText('Slide one').closest('article')).toHaveStyle({
      backgroundImage: 'url(/placeholder.png)',
    });
  });

  it('renders validated Footer social platforms as inert labels', () => {
    render(
      previewInertLinkBlocks.Footer.render({
        socialLinks: {
          facebook: '',
          instagram: 'https://instagram.com/store',
          x: 'https://x.com/store',
        },
        socialLinksLabel: 'Connect',
      })
    );

    expect(
      screen.getByRole('heading', { name: 'Connect' }).parentElement
    ).toHaveTextContent('Connectinstagramx');
    expect(screen.queryByText('facebook')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
