import sourceManifest from '../config/public-document-sources.json';
import {
  type PublicDocumentSource,
  validatePublicDocumentSources,
} from './validate-public-document-sources';

const OFFICIAL_URLS = [
  'https://chowdeck-api.readme.io/docs/getting-started.md',
  'https://chowdeck-api.readme.io/reference/authentication-1.md',
  'https://chowdeck-api.readme.io/reference/get-merchant-profile.md',
  'https://chowdeck-api.readme.io/docs/managing-your-menu.md',
  'https://chowdeck-api.readme.io/reference/create-menu-category.md',
  'https://chowdeck-api.readme.io/reference/list-menu-categories.md',
  'https://chowdeck-api.readme.io/reference/create-menu-item.md',
  'https://chowdeck-api.readme.io/reference/list-menu-items.md',
  'https://chowdeck-api.readme.io/reference/get-menu-item.md',
] as const;
const POSTMAN_URL =
  'https://documenter.getpostman.com/view/19177886/2s8Ysrytto';

describe('public source manifest', () => {
  it('contains only the nine literal Markdown URLs and quarantined Postman page', () => {
    const parsed = validatePublicDocumentSources(sourceManifest);

    expect(
      parsed.sources.filter((source) => source.fetch).map(({ url }) => url)
    ).toEqual(OFFICIAL_URLS);
    expect(parsed.sources.filter((source) => !source.fetch)).toEqual([
      { url: POSTMAN_URL, kind: 'quarantined_reference_only', fetch: false },
    ]);
  });

  it.each([
    ['non-HTTPS', 'http://chowdeck-api.readme.io/docs/getting-started.md'],
    [
      'lookalike host',
      'https://chowdeck-api.readme.io.evil.test/docs/getting-started.md',
    ],
    ['unknown path', 'https://chowdeck-api.readme.io/docs/other.md'],
    [
      'Postman API derivation',
      'https://documenter.getpostman.com/api/collections/19177886',
    ],
  ])('rejects a %s source', (_label, url) => {
    const sources = structuredClone(sourceManifest) as {
      version: number;
      sources: PublicDocumentSource[];
    };
    sources.sources[0] = { url, kind: 'official_markdown', fetch: true };

    expect(() => validatePublicDocumentSources(sources)).toThrow(
      'Invalid public source manifest'
    );
  });

  it('requires the Postman documentation page to remain unfetched', () => {
    const sources = structuredClone(sourceManifest) as {
      version: number;
      sources: PublicDocumentSource[];
    };
    const postman = sources.sources.at(-1);
    if (!postman) throw new Error('missing test source');
    postman.fetch = true;

    expect(() => validatePublicDocumentSources(sources)).toThrow(
      'Invalid public source manifest'
    );
  });
});
