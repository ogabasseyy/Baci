import type { Data } from '@puckeditor/core';
import { describe, expect, it } from 'vitest';
import { projectCopilotReadableComponents } from './project-copilot-readable-components';

describe('projectCopilotReadableComponents', () => {
  it('omits refused props and bounds editable carousel context', () => {
    const components = projectCopilotReadableComponents([
      {
        props: {
          code: 'x'.repeat(100_000),
          id: 'code-1',
        },
        type: 'CodeEmbed',
      },
      {
        props: {
          id: 'carousel-1',
          slides: [
            {
              ctaText: 'Shop now',
              image: '/private-image.png',
              title: 'First slide',
            },
            { ctaText: 'See more', title: 'Second slide' },
          ],
        },
        type: 'HeroCarousel',
      },
    ] as Data['content']);

    expect(components[0]).toEqual({
      id: 'code-1',
      index: 0,
      props: {},
      type: 'CodeEmbed',
    });
    expect(components[1]).toEqual({
      id: 'carousel-1',
      index: 1,
      props: {
        slides: [
          { ctaText: 'Shop now', slideIndex: 0, title: 'First slide' },
          { ctaText: 'See more', slideIndex: 1, title: 'Second slide' },
        ],
      },
      type: 'HeroCarousel',
    });
  });
});
