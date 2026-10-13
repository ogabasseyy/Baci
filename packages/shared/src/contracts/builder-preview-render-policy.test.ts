import { describe, expect, it } from 'vitest';
import { previewRenderPolicy } from './builder-preview-render-policy';

describe('preview render policy', () => {
  it('parses compound Puck dropzone keys while rejecting inert and unsafe keys', () => {
    expect(previewRenderPolicy.isPuckZoneKey('Flex-1234:children')).toBe(true);
    expect(previewRenderPolicy.isPuckZoneKey('aside')).toBe(false);
    expect(previewRenderPolicy.isPuckZoneKey('Flex-1234:<script>')).toBe(false);
    expect(previewRenderPolicy.isPuckZoneKey('Flex-1234:children:next')).toBe(
      false
    );
  });

  it('rejects malformed CSS colors and unsafe asset or gradient values', () => {
    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: { backgroundColor: '#12345', id: 'header-1' },
          type: 'Header',
        },
        new Set()
      )
    ).toBe(false);
    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: { backgroundColor: '#1234567', id: 'header-1' },
          type: 'Header',
        },
        new Set()
      )
    ).toBe(false);
  });

  it('rejects color variables that are not defined by the theme contract', () => {
    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: {
            backgroundColor: 'var(--theme-not-defined)',
            id: 'header-1',
          },
          type: 'Header',
        },
        new Set()
      )
    ).toBe(false);

    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: {
            backgroundColor: 'var(--store-not-defined)',
            id: 'header-1',
          },
          type: 'Header',
        },
        new Set()
      )
    ).toBe(false);

    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: {
            backgroundGradient:
              'linear-gradient(90deg, var(--theme-not-defined), #ffffff)',
            id: 'hero-1',
          },
          type: 'Hero',
        },
        new Set()
      )
    ).toBe(false);
  });

  it('accepts bounded curated render props without allowing unreviewed props', () => {
    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: {
            backgroundColor: '#111111',
            id: 'header-1',
            storeName: 'Acme Store',
          },
          type: 'Header',
        },
        new Set()
      )
    ).toBe(true);
    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: { headingLevel: 'h1', id: 'hero-1', title: 'Welcome' },
          type: 'Hero',
        },
        new Set()
      )
    ).toBe(true);
    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: { id: 'button-1', link: 'javascript:alert(1)' },
          type: 'Button',
        },
        new Set()
      )
    ).toBe(false);
    expect(
      previewRenderPolicy.isPuckComponent(
        { props: { id: 'header-1', unreviewed: true }, type: 'Header' },
        new Set()
      )
    ).toBe(false);
    expect(
      previewRenderPolicy.isPuckComponent(
        { props: { id: 'code-1' }, type: 'CodeEmbed' },
        new Set()
      )
    ).toBe(true);
  });

  it('accepts an explicitly cleared optional ProductGrid category', () => {
    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: { category: '', id: 'products-1' },
          type: 'ProductGrid',
        },
        new Set()
      )
    ).toBe(true);
  });

  it('accepts saved animation defaults for every render-safe animated block', () => {
    const animation = {
      animationDelay: 0,
      animationDuration: 'normal',
      animationTrigger: 'scroll',
      animationType: 'fade-in',
    };
    const components = [
      {
        props: {
          ...animation,
          align: 'center',
          ctaLink: '/products',
          ctaText: 'Shop now',
          id: 'hero-1',
          padding: 'large',
          subtitle: 'Discover our collection.',
          title: 'Featured collection',
        },
        type: 'Hero',
      },
      {
        props: {
          ...animation,
          align: 'left',
          content: 'Supporting copy',
          id: 'text-1',
          title: 'About us',
        },
        type: 'Text',
      },
      {
        props: {
          ...animation,
          columns: 3,
          features: [
            {
              description: 'Fast delivery',
              icon: 'truck',
              title: 'Shipping',
            },
          ],
          id: 'features-1',
          title: 'Why choose us',
        },
        type: 'Features',
      },
      {
        props: {
          ...animation,
          id: 'faq-1',
          items: [{ answer: 'Within days.', question: 'When?' }],
          style: 'accordion',
          title: 'Questions',
        },
        type: 'FAQ',
      },
      {
        props: {
          ...animation,
          id: 'legal-1',
          sections: [{ content: 'Terms apply.', heading: 'Terms' }],
          title: 'Policy',
        },
        type: 'LegalSection',
      },
    ];

    expect(
      components.every((component) =>
        previewRenderPolicy.isPuckComponent(component, new Set())
      )
    ).toBe(true);
  });

  it('rejects unsupported animation values on render-safe blocks', () => {
    expect(
      previewRenderPolicy.isPuckComponent(
        {
          props: {
            animationDelay: 6,
            animationDuration: 'instant',
            animationTrigger: 'unsafe',
            animationType: 'javascript',
            id: 'text-1',
          },
          type: 'Text',
        },
        new Set()
      )
    ).toBe(false);
  });
});
