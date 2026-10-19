import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BlogFeaturedStoryFrame } from './blog-featured-story-frame';

describe('BlogFeaturedStoryFrame', () => {
  it('reserves the featured-story box without fetching listing data', () => {
    const { container } = render(<BlogFeaturedStoryFrame />);

    expect(container.firstElementChild).toHaveClass('md:h-[500px]');
    expect(container.innerHTML).not.toContain(
      'ogabassey-blog-featured-story__media'
    );
  });
});
