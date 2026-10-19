import { describe, expect, it } from 'vitest';
import { getVisiblePrerenderHtml } from './visible-prerender-html';

describe('getVisiblePrerenderHtml', () => {
  it('keeps PPR fallback siblings and drops hidden resume slots', () => {
    const html = [
      '<div class="storefront-ppr-static-shell__fallback">Compare products</div>',
      '<div hidden id="S:2"><div class="storefront-ppr-static-shell__content">',
      '<div class="ogabassey-blog-featured-story__media">hidden hero</div>',
      '</div></div>',
    ].join('');

    const visible = getVisiblePrerenderHtml(html);

    expect(visible).toContain('Compare products');
    expect(visible).not.toContain('ogabassey-blog-featured-story__media');
    expect(visible).not.toContain('hidden hero');
  });

  it('does not treat overflow-hidden class names as PPR holes', () => {
    const html =
      '<div class="overflow-hidden rounded-2xl">visible card</div>' +
      '<div hidden="">secret</div>';

    const visible = getVisiblePrerenderHtml(html);

    expect(visible).toContain('visible card');
    expect(visible).not.toContain('secret');
  });

  it('keeps featured media that sits in the PPR fallback sibling', () => {
    const html = [
      '<div class="storefront-ppr-static-shell__fallback">',
      '<div class="ogabassey-blog-featured-story__media">visible hero</div>',
      '</div>',
      '<div hidden id="S:2">postponed listing</div>',
    ].join('');

    const visible = getVisiblePrerenderHtml(html);

    expect(visible).toContain('ogabassey-blog-featured-story__media');
    expect(visible).toContain('visible hero');
    expect(visible).not.toContain('postponed listing');
  });

  it('ignores featured markup that only exists inside a template hole', () => {
    const html =
      '<template id="B:1"><div class="ogabassey-blog-featured-story__media"></div></template>' +
      '<p>Blog | Ogabassey</p>';

    const visible = getVisiblePrerenderHtml(html);

    expect(visible).toContain('Blog | Ogabassey');
    expect(visible).not.toContain('ogabassey-blog-featured-story__media');
  });
});
