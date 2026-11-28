import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the module under test is imported so that
// Vitest's hoisting puts them at the top of the compiled output.
// ---------------------------------------------------------------------------

// SafeHtml: render its `html` prop as plain text inside a div so we can
// assert on the content that would have been sanitised and injected.
vi.mock('@/components/ui/safe-html', () => ({
  SafeHtml: ({
    as: Tag = 'div',
    html,
    className,
  }: {
    as?: 'code' | 'div' | 'span';
    className?: string;
    headingLevelOffset?: number;
    html: string;
  }) => (
    <Tag
      className={className}
      data-testid="safe-html"
      data-classname={className ?? ''}
    >
      {html}
    </Tag>
  ),
}));

// Pass-through: return the URL unchanged so link assertions are predictable.
vi.mock('@/lib/sanitize-core', () => ({
  sanitizeUrl: vi.fn((url: string) => url),
}));

// sanitize is imported by SafeHtml (already mocked above), but Vitest resolves
// the real module graph unless we mock it as well.
vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

// Lowlight: echo the source code back so highlighted HTML equals the input.
vi.mock('lowlight', () => {
  const makeTree = (code: string) => ({
    type: 'root',
    children: [{ type: 'text', value: code }],
  });
  return {
    common: {},
    createLowlight: () => ({
      highlight: vi.fn((_lang: string, code: string) => makeTree(code)),
      highlightAuto: vi.fn((code: string) => makeTree(code)),
      registered: vi.fn(() => true),
    }),
  };
});

// hast-util-to-html: join child text values into a plain string.
vi.mock('hast-util-to-html', () => ({
  toHtml: vi.fn((tree: { children: Array<{ value?: string }> }) =>
    tree.children.map((c) => c.value ?? '').join('')
  ),
}));

type MockImageSrc = string | { src: string } | { default: { src: string } };

type MockNextImageProps = {
  alt?: string;
  fill?: boolean;
  src?: MockImageSrc;
} & Record<string, unknown>;

vi.mock('next/image', () => ({
  default: ({ src, alt, fill: _fill, ...props }: MockNextImageProps) => {
    const normalizedSrc =
      typeof src === 'string'
        ? src
        : src && 'default' in src
          ? src.default.src
          : src?.src;

    // biome-ignore lint/performance/noImgElement: Next.js Image component cannot be fully mocked simply
    return <img alt={alt} src={normalizedSrc} {...props} />;
  },
}));

import { BlogContentRenderer } from './BlogContentRenderer';

// ---------------------------------------------------------------------------
// Local TipTap node factory helpers
// ---------------------------------------------------------------------------

type Mark = { type: string; attrs?: Record<string, unknown> };
type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: Mark[];
  text?: string;
};

const doc = (...content: TipTapNode[]): TipTapNode => ({
  type: 'doc',
  content,
});

const paragraph = (...content: TipTapNode[]): TipTapNode => ({
  type: 'paragraph',
  content,
});

const textNode = (value: string, marks?: Mark[]): TipTapNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

const headingNode = (level: number, ...content: TipTapNode[]): TipTapNode => ({
  type: 'heading',
  attrs: { level },
  content,
});

// ---------------------------------------------------------------------------

describe('BlogContentRenderer', () => {
  // -------------------------------------------------------------------------
  // Null / falsy guard
  // -------------------------------------------------------------------------

  describe('when json is falsy', () => {
    it('renders nothing for null', () => {
      const { container } = render(<BlogContentRenderer json={null} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for undefined', () => {
      const { container } = render(<BlogContentRenderer json={undefined} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing for an empty string', () => {
      const { container } = render(<BlogContentRenderer json={''} />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  // -------------------------------------------------------------------------
  // Paragraph
  // -------------------------------------------------------------------------

  describe('paragraph nodes', () => {
    it('renders text content inside a <p>', () => {
      render(
        <BlogContentRenderer json={doc(paragraph(textNode('Hello Baci')))} />
      );
      expect(screen.getByText('Hello Baci')).toBeInTheDocument();
    });

    it('renders an empty paragraph as a <br>', () => {
      const { container } = render(
        <BlogContentRenderer json={doc({ type: 'paragraph', content: [] })} />
      );
      expect(container.querySelector('br')).toBeInTheDocument();
    });

    it('applies text-center class when textAlign is center', () => {
      const json = doc({
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: [textNode('Centred')],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('p')).toHaveClass('text-center');
    });

    it('applies text-right class when textAlign is right', () => {
      const json = doc({
        type: 'paragraph',
        attrs: { textAlign: 'right' },
        content: [textNode('Right')],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('p')).toHaveClass('text-right');
    });

    it('applies text-justify class when textAlign is justify', () => {
      const json = doc({
        type: 'paragraph',
        attrs: { textAlign: 'justify' },
        content: [textNode('Justified')],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('p')).toHaveClass('text-justify');
    });
  });

  // -------------------------------------------------------------------------
  // Headings
  // -------------------------------------------------------------------------

  describe('heading nodes', () => {
    it.each([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 6],
    ] as const)('renders source level %i as an <h%i> article-body heading', (sourceLevel, renderedLevel) => {
      const json = doc(
        headingNode(sourceLevel, textNode(`Heading ${sourceLevel}`))
      );
      const { container } = render(<BlogContentRenderer json={json} />);
      const el = container.querySelector(`h${renderedLevel}`);
      expect(el).toBeInTheDocument();
      expect(el).toHaveTextContent(`Heading ${sourceLevel}`);
    });

    it('does not render a body h1 below the blog post page heading', () => {
      const json = doc(headingNode(1, textNode('Imported Title')));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('h1')).toBeNull();
      expect(
        screen.getByRole('heading', { level: 2, name: /Imported Title/i })
      ).toBeInTheDocument();
    });

    it('generates a slug id from the heading text', () => {
      const json = doc(headingNode(1, textNode('My Section Title')));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('h2')).toHaveAttribute(
        'id',
        'my-section-title'
      );
    });

    it('renders a self-link anchor next to the heading', () => {
      const json = doc(headingNode(2, textNode('About Us')));
      render(<BlogContentRenderer json={json} />);
      const anchor = screen.getByRole('link', { name: 'Link to About Us' });
      expect(anchor).toHaveAttribute('href', '#about-us');
    });

    it('sets the scroll-mt-20 class for sticky-header offset', () => {
      const json = doc(headingNode(1, textNode('Title')));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('h2')).toHaveClass('scroll-mt-20');
    });
  });

  // -------------------------------------------------------------------------
  // Lists
  // -------------------------------------------------------------------------

  describe('list nodes', () => {
    it('renders a bullet list with list items', () => {
      const json = doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(textNode('Alpha'))] },
          { type: 'listItem', content: [paragraph(textNode('Beta'))] },
        ],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('ul')).toBeInTheDocument();
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('renders an ordered list with list items', () => {
      const json = doc({
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [paragraph(textNode('First'))] },
          { type: 'listItem', content: [paragraph(textNode('Second'))] },
        ],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('ol')).toBeInTheDocument();
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Inline text marks
  // -------------------------------------------------------------------------

  describe('text marks', () => {
    it('wraps bold text in <strong>', () => {
      const json = doc(paragraph(textNode('Bold', [{ type: 'bold' }])));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('strong')).toHaveTextContent('Bold');
    });

    it('wraps italic text in <em>', () => {
      const json = doc(paragraph(textNode('Italic', [{ type: 'italic' }])));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('em')).toHaveTextContent('Italic');
    });

    it('wraps underline text in <u>', () => {
      const json = doc(paragraph(textNode('Under', [{ type: 'underline' }])));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('u')).toHaveTextContent('Under');
    });

    it('wraps strikethrough text in <s>', () => {
      const json = doc(paragraph(textNode('Strike', [{ type: 'strike' }])));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('s')).toHaveTextContent('Strike');
    });

    it('wraps inline code in <code>', () => {
      const json = doc(paragraph(textNode('fn()', [{ type: 'code' }])));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('code')).toHaveTextContent('fn()');
    });

    it('renders an external link with noopener noreferrer and _blank target', () => {
      const json = doc(
        paragraph(
          textNode('Visit', [
            {
              type: 'link',
              attrs: { href: 'https://example.com', target: '_blank' },
            },
          ])
        )
      );
      render(<BlogContentRenderer json={json} />);
      const link = screen.getByRole('link', { name: 'Visit' });
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('renders a relative link without rel or target', () => {
      const json = doc(
        paragraph(
          textNode('Home', [{ type: 'link', attrs: { href: '/home' } }])
        )
      );
      render(<BlogContentRenderer json={json} />);
      const link = screen.getByRole('link', { name: 'Home' });
      expect(link).toHaveAttribute('href', '/home');
      expect(link).not.toHaveAttribute('rel');
      expect(link).not.toHaveAttribute('target');
    });

    it('renders an anchor (#hash) link without rel or target', () => {
      const json = doc(
        paragraph(
          textNode('Jump', [{ type: 'link', attrs: { href: '#section' } }])
        )
      );
      render(<BlogContentRenderer json={json} />);
      const link = screen.getByRole('link', { name: 'Jump' });
      expect(link).toHaveAttribute('href', '#section');
      expect(link).not.toHaveAttribute('rel');
    });

    it('normalizes legacy internal storefront links before rendering', () => {
      const json = doc(
        paragraph(
          textNode('iPhone', [
            {
              type: 'link',
              attrs: {
                href: 'https://www.ogabassey.com/phones/iPhone-13-Pro-6GB-256GB?srsltid=test',
              },
            },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          baseUrl="https://ogabassey.com"
          merchantSlug="ogabassey"
        />
      );

      expect(screen.getByRole('link', { name: 'iPhone' })).toHaveAttribute(
        'href',
        '/smartphones/iphone-13-pro-6gb-256gb'
      );
    });

    it('renders technical resource links as plain text for JSON posts', () => {
      const json = doc(
        paragraph(
          textNode('Product data JSON', [
            {
              type: 'link',
              attrs: { href: 'https://example.com/assets/specs.json' },
            },
          ]),
          textNode(' and '),
          textNode('Optimized image', [
            {
              type: 'link',
              attrs: {
                href: '/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fphone.avif&w=640&q=75',
              },
            },
          ])
        )
      );

      render(<BlogContentRenderer json={json} />);

      expect(screen.getByText('Product data JSON')).toBeInTheDocument();
      expect(screen.getByText('Optimized image')).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Product data JSON' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: 'Optimized image' })
      ).not.toBeInTheDocument();
    });

    it('rewrites javascript: URLs to a safe hash anchor', () => {
      const json = doc(
        paragraph(
          textNode('Evil', [
            { type: 'link', attrs: { href: 'javascript:alert(1)' } },
          ])
        )
      );
      render(<BlogContentRenderer json={json} />);
      expect(screen.getByRole('link', { name: 'Evil' })).toHaveAttribute(
        'href',
        '#'
      );
    });

    it('renders a plain <span> for a link resolving to a dead blog slug', () => {
      const json = doc(
        paragraph(
          textNode('Read More', [
            { type: 'link', attrs: { href: '/blog/draft-post' } },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          deadContentLinks={{ blog: ['draft-post'], products: [] }}
        />
      );

      expect(
        screen.queryByRole('link', { name: 'Read More' })
      ).not.toBeInTheDocument();
      expect(screen.getByText('Read More').tagName).toBe('SPAN');
    });

    it('renders a plain <span> for a link resolving to a dead product slug', () => {
      const json = doc(
        paragraph(
          textNode('Shop Now', [
            { type: 'link', attrs: { href: '/products/missing-item' } },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          deadContentLinks={{ blog: [], products: ['missing-item'] }}
        />
      );

      expect(
        screen.queryByRole('link', { name: 'Shop Now' })
      ).not.toBeInTheDocument();
      expect(screen.getByText('Shop Now').tagName).toBe('SPAN');
    });

    it('keeps a link that is not present in the dead content link sets', () => {
      const json = doc(
        paragraph(
          textNode('Live Post', [
            { type: 'link', attrs: { href: '/blog/live-post' } },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          deadContentLinks={{ blog: ['draft-post'], products: [] }}
        />
      );

      expect(screen.getByRole('link', { name: 'Live Post' })).toHaveAttribute(
        'href',
        '/blog/live-post'
      );
    });

    it('rewrites a redirectable product link to its canonical path instead of unwrapping', () => {
      const json = doc(
        paragraph(
          textNode('AirPods 2', [
            { type: 'link', attrs: { href: '/audio/apple-airpods-2' } },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          contentLinkRewrites={{
            blogSlugs: {},
            productPaths: { 'apple-airpods-2': '/earbuds/apple-airpods-2' },
          }}
          deadContentLinks={{ blog: [], products: ['apple-airpods-2'] }}
        />
      );

      expect(screen.getByRole('link', { name: 'AirPods 2' })).toHaveAttribute(
        'href',
        '/earbuds/apple-airpods-2'
      );
    });

    it('rewrites a renamed blog post link to the live slug', () => {
      const json = doc(
        paragraph(
          textNode('Used iPhone Guide', [
            { type: 'link', attrs: { href: '/blog/buying-a-used-iphone' } },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          contentLinkRewrites={{
            blogSlugs: { 'buying-a-used-iphone': 'used-iphone-checklist' },
            productPaths: {},
          }}
        />
      );

      expect(
        screen.getByRole('link', { name: 'Used iPhone Guide' })
      ).toHaveAttribute('href', '/blog/used-iphone-checklist');
    });

    it('treats empty dead content link arrays the same as no dead links', () => {
      const json = doc(
        paragraph(
          textNode('Read More', [
            { type: 'link', attrs: { href: '/blog/draft-post' } },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          deadContentLinks={{ blog: [], products: [] }}
        />
      );

      expect(
        screen.getByRole('link', { name: 'Read More' })
      ).toBeInTheDocument();
    });

    it('does not unwrap external links even when the path segment matches a dead slug', () => {
      const json = doc(
        paragraph(
          textNode('External', [
            {
              type: 'link',
              attrs: { href: 'https://example.com/blog/draft-post' },
            },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          deadContentLinks={{ blog: ['draft-post'], products: [] }}
        />
      );

      expect(
        screen.getByRole('link', { name: 'External' })
      ).toBeInTheDocument();
    });

    it('unwraps dead links normalized under a path-mode basePath', () => {
      const json = doc(
        paragraph(
          textNode('Draft', [
            { type: 'link', attrs: { href: '/blog/draft-post' } },
          ])
        )
      );

      render(
        <BlogContentRenderer
          json={json}
          basePath="/ogabassey"
          merchantSlug="ogabassey"
          deadContentLinks={{ blog: ['draft-post'], products: [] }}
        />
      );

      expect(
        screen.queryByRole('link', { name: 'Draft' })
      ).not.toBeInTheDocument();
      expect(screen.getByText('Draft').tagName).toBe('SPAN');
    });

    it('applies a color style from the textStyle mark', () => {
      const json = doc(
        paragraph(
          textNode('Red text', [{ type: 'textStyle', attrs: { color: 'red' } }])
        )
      );
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('span')).toHaveStyle({
        color: 'rgb(255, 0, 0)',
      });
    });

    it('renders plain text when there are no marks', () => {
      const json = doc(paragraph(textNode('Plain')));
      render(<BlogContentRenderer json={json} />);
      expect(screen.getByText('Plain')).toBeInTheDocument();
    });

    it('returns null for a text node with no text property', () => {
      const json = doc(paragraph({ type: 'text' } as TipTapNode));
      expect(() => render(<BlogContentRenderer json={json} />)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Code blocks with syntax highlighting
  // -------------------------------------------------------------------------

  describe('codeBlock nodes', () => {
    it('renders highlighted code in a <code> element with a language class', () => {
      const json = doc({
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [{ type: 'text', text: 'const x = 1;' }],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      const codeEl = container.querySelector('pre code');
      expect(codeEl).toBeInTheDocument();
      expect(codeEl).toHaveClass('language-javascript');
      expect(codeEl?.innerHTML).toContain('const');
    });

    it('wraps code output in a <pre> element', () => {
      const json = doc({
        type: 'codeBlock',
        attrs: { language: 'typescript' },
        content: [{ type: 'text', text: 'let y: number = 2;' }],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('pre')).toBeInTheDocument();
    });

    it('falls back to <pre><code> when toHtml returns an empty string', async () => {
      const { toHtml } = await import('hast-util-to-html');
      vi.mocked(toHtml).mockReturnValueOnce('');

      const json = doc({
        type: 'codeBlock',
        attrs: { language: '' },
        content: [{ type: 'text', text: 'plain code' }],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('pre code')).toBeInTheDocument();
      expect(screen.queryByTestId('safe-html')).not.toBeInTheDocument();
    });

    it('falls back to <pre><code> when the highlighter throws', async () => {
      const { toHtml } = await import('hast-util-to-html');
      vi.mocked(toHtml).mockImplementationOnce(() => {
        throw new Error('highlight crash');
      });

      const json = doc({
        type: 'codeBlock',
        attrs: { language: 'js' },
        content: [{ type: 'text', text: 'crash()' }],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      // codeBlock has its own internal try/catch — should not propagate
      expect(container.querySelector('pre')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Block elements
  // -------------------------------------------------------------------------

  describe('blockquote nodes', () => {
    it('renders a <blockquote> wrapping its content', () => {
      const json = doc({
        type: 'blockquote',
        content: [paragraph(textNode('A wise quote'))],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('blockquote')).toBeInTheDocument();
      expect(screen.getByText('A wise quote')).toBeInTheDocument();
    });
  });

  describe('horizontalRule node', () => {
    it('renders an <hr>', () => {
      const json = doc({ type: 'horizontalRule' });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('hr')).toBeInTheDocument();
    });
  });

  describe('hardBreak node', () => {
    it('renders a <br> inline with surrounding text', () => {
      const json = doc(
        paragraph(textNode('Line 1'), { type: 'hardBreak' }, textNode('Line 2'))
      );
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('br')).toBeInTheDocument();
      // 'Line 1' and 'Line 2' are text nodes split by <br>, so use container
      // rather than screen.getByText to avoid the "text broken up" error.
      expect(container).toHaveTextContent('Line 1');
      expect(container).toHaveTextContent('Line 2');
    });
  });

  // -------------------------------------------------------------------------
  // Image nodes
  // -------------------------------------------------------------------------

  describe('image nodes', () => {
    it('renders an image with the given src and alt', () => {
      const json = doc({
        type: 'image',
        attrs: { src: 'https://cdn.example.com/photo.jpg', alt: 'A photo' },
      });
      render(<BlogContentRenderer json={json} />);
      const image = screen.getByAltText('A photo');
      expect(image).toBeInTheDocument();
      expect(image).toHaveAttribute('src', 'https://cdn.example.com/photo.jpg');
      expect(image).toHaveAttribute('sizes', '(max-width: 768px) 100vw, 800px');
    });

    it('uses "Blog image" as default alt when alt is absent', () => {
      const json = doc({
        type: 'image',
        attrs: { src: 'https://cdn.example.com/photo.jpg' },
      });
      render(<BlogContentRenderer json={json} />);
      const image = screen.getByAltText('Blog image');
      expect(image).toBeInTheDocument();
      expect(image).toHaveAttribute('src', 'https://cdn.example.com/photo.jpg');
    });

    it('renders semantic caption markup for image title captions', () => {
      const json = doc({
        type: 'image',
        attrs: {
          src: 'https://cdn.example.com/photo.jpg',
          alt: 'A photo',
          title: 'Front camera sample',
        },
      });

      const { container } = render(<BlogContentRenderer json={json} />);

      expect(screen.getByText('Front camera sample')).toBeInTheDocument();
      expect(container.querySelector('figcaption')).toHaveTextContent(
        'Front camera sample'
      );
      expect(container.querySelector('figure')).toHaveClass('my-10');
      const imageWrapper = container.querySelector(
        'figure > div.relative.aspect-video'
      );
      expect(imageWrapper).toBeInTheDocument();
      expect(imageWrapper).not.toHaveClass('my-10');
    });

    it('does not render empty figcaption wrappers for captionless images', () => {
      const json = doc({
        type: 'image',
        attrs: { src: 'https://cdn.example.com/photo.jpg', alt: 'A photo' },
      });

      const { container } = render(<BlogContentRenderer json={json} />);

      expect(container.querySelector('figcaption')).not.toBeInTheDocument();
      expect(container.querySelector('figure')).not.toBeInTheDocument();
      const imageWrapper = container.querySelector('div.relative.aspect-video');
      expect(imageWrapper).toBeInTheDocument();
      expect(imageWrapper).toHaveClass('my-10');
    });

    it('does not render an image when src is null', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const json = doc({ type: 'image', attrs: { src: null } });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('img')).not.toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Blog image node missing or invalid src attribute'
        ),
        expect.objectContaining({ src: null })
      );
      consoleSpy.mockRestore();
    });

    it('does not render an image for a non-http URL (e.g. data:)', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const json = doc({
        type: 'image',
        attrs: { src: 'data:image/png;base64,abc' },
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('img')).not.toBeInTheDocument();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Blog image node missing or invalid src attribute'
        ),
        expect.objectContaining({ src: 'data:image/png;base64,abc' })
      );
      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Table nodes
  // -------------------------------------------------------------------------

  describe('table nodes', () => {
    it('renders table, th, and td elements with content', () => {
      const json = doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [paragraph(textNode('Name'))] },
              { type: 'tableHeader', content: [paragraph(textNode('Price'))] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [paragraph(textNode('Widget'))] },
              { type: 'tableCell', content: [paragraph(textNode('₦100'))] },
            ],
          },
        ],
      });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('table')).toBeInTheDocument();
      expect(container.querySelector('th')).toBeInTheDocument();
      expect(container.querySelector('td')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Widget')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Unknown node types
  // -------------------------------------------------------------------------

  describe('unknown node types', () => {
    it('returns null and emits a console warning', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const json = doc({ type: 'customWidget' });
      const { container } = render(<BlogContentRenderer json={json} />);
      // The doc wrapper renders but contains no visible child content.
      expect(container.querySelector('.space-y-4')).toBeEmptyDOMElement();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown blog renderer node type'),
        expect.objectContaining({ nodeType: 'customWidget' })
      );
      consoleSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Legacy HTML fallback (root type !== 'doc')
  // -------------------------------------------------------------------------

  describe('legacy HTML fallback', () => {
    it('passes the raw HTML string to SafeHtml when JSON.parse throws', () => {
      // Not valid JSON → catch branch fires.
      const html = '<p>Legacy <strong>content</strong></p>';
      render(<BlogContentRenderer json={html} />);
      expect(screen.getByTestId('safe-html')).toHaveTextContent(html);
    });

    it('passes empty string to SafeHtml when the object root type is not "doc"', () => {
      // json is an object (not a string), so SafeHtml receives '' as fallback.
      const json = { type: 'prose', content: [] };
      render(<BlogContentRenderer json={json} />);
      const safeHtml = screen.getByTestId('safe-html');
      expect(safeHtml).toBeInTheDocument();
      expect(safeHtml).toHaveTextContent('');
    });

    it('uses SafeHtml when the parsed JSON root type is not "doc"', () => {
      // json is a valid JSON string, but the parsed root type is not 'doc'.
      const nonDocJson = JSON.stringify({ type: 'prose', content: [] });
      render(<BlogContentRenderer json={nonDocJson} />);
      expect(screen.getByTestId('safe-html')).toBeInTheDocument();
    });

    it('renders the outer wrapper with blog-content-renderer class for valid docs', () => {
      const json = doc(paragraph(textNode('Content')));
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(
        container.querySelector('.blog-content-renderer')
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases and robustness
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('does not throw on deeply nested paragraphs', () => {
      const deepNode = (depth: number): TipTapNode =>
        depth === 0 ? textNode('deep') : paragraph(deepNode(depth - 1));

      const json = doc(deepNode(15));
      expect(() => render(<BlogContentRenderer json={json} />)).not.toThrow();
      expect(screen.getByText('deep')).toBeInTheDocument();
    });

    it('handles multiple paragraph nodes at the doc root', () => {
      const json = doc(
        paragraph(textNode('First paragraph')),
        paragraph(textNode('Second paragraph')),
        paragraph(textNode('Third paragraph'))
      );
      render(<BlogContentRenderer json={json} />);
      expect(screen.getByText('First paragraph')).toBeInTheDocument();
      expect(screen.getByText('Second paragraph')).toBeInTheDocument();
      expect(screen.getByText('Third paragraph')).toBeInTheDocument();
    });

    it('renders a paragraph with no content as <br> (undefined content)', () => {
      const json = doc({ type: 'paragraph' });
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('br')).toBeInTheDocument();
    });

    it('renders an ordered list and bullet list together in the same doc', () => {
      const json = doc(
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph(textNode('Bullet'))] },
          ],
        },
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [paragraph(textNode('Ordered'))] },
          ],
        }
      );
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('ul')).toBeInTheDocument();
      expect(container.querySelector('ol')).toBeInTheDocument();
    });

    it('renders multiple marks on the same text node', () => {
      const json = doc(
        paragraph(
          textNode('Bold and Italic', [{ type: 'bold' }, { type: 'italic' }])
        )
      );
      const { container } = render(<BlogContentRenderer json={json} />);
      expect(container.querySelector('strong em, em strong')).toHaveTextContent(
        'Bold and Italic'
      );
    });
  });

  describe('inline image optimization', () => {
    const makeImageDoc = (src: string) => ({
      type: 'doc',
      content: [{ type: 'image', attrs: { src, alt: 'Speaker' } }],
    });

    it('serves trusted CDN inline images as <picture> with avif/webp sources', () => {
      const src =
        'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/x/inline-1-b9244d7a754d.png';
      const { container } = render(
        <BlogContentRenderer json={makeImageDoc(src)} />
      );

      const picture = container.querySelector('picture');
      expect(picture).toBeTruthy();
      expect(
        picture
          ?.querySelector('source[type="image/avif"]')
          ?.getAttribute('srcset')
      ).toContain(
        'width=384,quality=70,format=avif/core-assets/blog/x/inline-1-b9244d7a754d.png.avif 384w'
      );
      expect(
        picture
          ?.querySelector('source[type="image/webp"]')
          ?.getAttribute('srcset')
      ).toContain(
        'width=384,quality=70,format=webp/core-assets/blog/x/inline-1-b9244d7a754d.png.webp 384w'
      );
      const img = picture?.querySelector('img');
      expect(img?.getAttribute('src')).toContain('width=828');
      expect(img?.getAttribute('srcset')).toContain(
        'width=384,quality=70,format=png/core-assets/blog/x/inline-1-b9244d7a754d.png 384w'
      );
      expect(img?.getAttribute('sizes')).toBe(
        '(max-width: 768px) calc(100vw - 3rem), 800px'
      );
      expect(img?.getAttribute('width')).toBeNull();
      expect(img?.getAttribute('height')).toBeNull();
      expect(img?.getAttribute('alt')).toBe('Speaker');
    });

    it('leaves legacy inline images without generated sibling markers as plain images', () => {
      const src =
        'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/x/inline-1.png';
      const { container } = render(
        <BlogContentRenderer json={makeImageDoc(src)} />
      );

      expect(container.querySelector('picture')).toBeNull();
      expect(container.querySelector('img')?.getAttribute('src')).toBe(src);
    });

    it('does not render legacy OgaBassey CDN blog images that crawl as 404s', () => {
      const src =
        'https://cdn.ogabassey.com/blog/2024/06/Redmi-13-4-768x960-1.jpg';
      render(<BlogContentRenderer json={makeImageDoc(src)} />);

      expect(screen.queryByRole('img')).toBeNull();
    });

    it('prioritizes the first trusted inline image and lazy-loads later inline images', () => {
      const firstSrc =
        'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/x/inline-1-b9244d7a754d.png';
      const secondSrc =
        'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/x/inline-2-b9244d7a754d.png';
      render(
        <BlogContentRenderer
          json={doc(
            paragraph(textNode('Intro')),
            { type: 'image', attrs: { src: firstSrc, alt: 'First inline' } },
            { type: 'image', attrs: { src: secondSrc, alt: 'Second inline' } }
          )}
        />
      );

      const images = screen.getAllByRole('img');
      expect(images).toHaveLength(2);
      expect(images[0]?.getAttribute('src')).toContain(
        'width=828,quality=70,format=png/core-assets/blog/x/inline-1-b9244d7a754d.png'
      );
      expect(images[0]).toHaveAttribute('fetchpriority', 'high');
      expect(images[0]).toHaveAttribute('loading', 'eager');
      expect(images[1]?.getAttribute('src')).toContain(
        'width=828,quality=70,format=png/core-assets/blog/x/inline-2-b9244d7a754d.png'
      );
      expect(images[1]).not.toHaveAttribute('fetchpriority');
      expect(images[1]).toHaveAttribute('loading', 'lazy');
    });

    it('prioritizes the first trusted inline image after removing a legacy CDN image', () => {
      const legacySrc =
        'https://cdn.ogabassey.com/blog/2024/06/Redmi-13-4-768x960-1.jpg';
      const trustedSrc =
        'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/x/inline-1-b9244d7a754d.png';
      render(
        <BlogContentRenderer
          json={doc(
            { type: 'image', attrs: { src: legacySrc, alt: 'Removed image' } },
            { type: 'image', attrs: { src: trustedSrc, alt: 'Trusted image' } }
          )}
        />
      );

      expect(screen.queryByRole('img', { name: 'Removed image' })).toBeNull();
      const images = screen.getAllByRole('img');
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute('src')).toContain(
        'width=828,quality=70,format=png/core-assets/blog/x/inline-1-b9244d7a754d.png'
      );
      expect(images[0]).toHaveAttribute('fetchpriority', 'high');
      expect(images[0]).toHaveAttribute('loading', 'eager');
    });

    it('does not prioritize a later trusted inline image when the first rendered image is untrusted', () => {
      const firstSrc = 'https://example.com/body-first.png';
      const secondSrc =
        'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/x/inline-2-b9244d7a754d.png';
      const { container } = render(
        <BlogContentRenderer
          json={doc(
            { type: 'image', attrs: { src: firstSrc, alt: 'First body' } },
            { type: 'image', attrs: { src: secondSrc, alt: 'Second inline' } }
          )}
        />
      );

      const allImages = Array.from(container.querySelectorAll('img'));
      expect(allImages[0]).toHaveAttribute('src', firstSrc);
      const trustedInlineImage = container.querySelector('picture img');
      expect(trustedInlineImage?.getAttribute('src')).toContain(
        'width=828,quality=70,format=png/core-assets/blog/x/inline-2-b9244d7a754d.png'
      );
      expect(trustedInlineImage).not.toHaveAttribute('fetchpriority');
      expect(trustedInlineImage).toHaveAttribute('loading', 'lazy');
    });

    it('prioritizes only the first occurrence when an inline image URL repeats', () => {
      const src =
        'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/x/inline-1-b9244d7a754d.png';
      const { container } = render(
        <BlogContentRenderer
          json={doc(
            { type: 'image', attrs: { src, alt: 'First occurrence' } },
            paragraph(textNode('Middle copy')),
            { type: 'image', attrs: { src, alt: 'Repeated occurrence' } }
          )}
        />
      );

      const images = Array.from(container.querySelectorAll('picture img'));
      expect(images).toHaveLength(2);
      expect(images[0]).toHaveAttribute('fetchpriority', 'high');
      expect(images[0]).toHaveAttribute('loading', 'eager');
      expect(images[1]).not.toHaveAttribute('fetchpriority');
      expect(images[1]).toHaveAttribute('loading', 'lazy');
    });

    it('leaves inline images lazy when another page image is already prioritized', () => {
      const src =
        'https://cdn.ogabassey.com/image/format=auto/core-assets/blog/x/inline-1-b9244d7a754d.png';
      const { container } = render(
        <BlogContentRenderer
          json={makeImageDoc(src)}
          priorityInlineImageSrc={null}
        />
      );

      const img = container.querySelector('picture img');
      expect(img?.getAttribute('src')).toContain(
        'width=828,quality=70,format=png/core-assets/blog/x/inline-1-b9244d7a754d.png'
      );
      expect(img).not.toHaveAttribute('fetchpriority');
      expect(img).toHaveAttribute('loading', 'lazy');
    });

    it('renders non-CDN images without a <picture> wrapper', () => {
      const { container } = render(
        <BlogContentRenderer json={makeImageDoc('https://example.com/x.png')} />
      );

      expect(container.querySelector('picture')).toBeNull();
      expect(container.querySelector('img')).toBeTruthy();
    });
  });
});
