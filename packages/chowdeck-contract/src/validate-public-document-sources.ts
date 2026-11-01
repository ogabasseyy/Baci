import type { ChowdeckEvidenceClaimV1 } from './evidence-schema';
import { sourceManifestSchema } from './schemas/public-document-sources';

export type PublicDocumentSource = {
  url: string;
  kind: 'official_markdown' | 'quarantined_reference_only';
  fetch: boolean;
};

export const OFFICIAL_SOURCES = [
  ['https://chowdeck-api.readme.io/docs/getting-started.md', 'errors'],
  [
    'https://chowdeck-api.readme.io/reference/authentication-1.md',
    'authentication',
  ],
  [
    'https://chowdeck-api.readme.io/reference/get-merchant-profile.md',
    'account.read',
  ],
  ['https://chowdeck-api.readme.io/docs/managing-your-menu.md', 'menu.manage'],
  [
    'https://chowdeck-api.readme.io/reference/create-menu-category.md',
    'menu.category.create',
  ],
  [
    'https://chowdeck-api.readme.io/reference/list-menu-categories.md',
    'menu.category.list',
  ],
  [
    'https://chowdeck-api.readme.io/reference/create-menu-item.md',
    'menu.item.create',
  ],
  [
    'https://chowdeck-api.readme.io/reference/list-menu-items.md',
    'menu.item.list',
  ],
  [
    'https://chowdeck-api.readme.io/reference/get-menu-item.md',
    'menu.item.read',
  ],
] as const satisfies ReadonlyArray<
  readonly [string, ChowdeckEvidenceClaimV1['capability']]
>;
const POSTMAN_URL =
  'https://documenter.getpostman.com/view/19177886/2s8Ysrytto';

export function validatePublicDocumentSources(input: unknown): {
  version: 1;
  sources: PublicDocumentSource[];
} {
  try {
    const parsed = sourceManifestSchema.parse(input);
    const expected: PublicDocumentSource[] = [
      ...OFFICIAL_SOURCES.map(([url]) => ({
        url,
        kind: 'official_markdown' as const,
        fetch: true,
      })),
      { url: POSTMAN_URL, kind: 'quarantined_reference_only', fetch: false },
    ];
    if (JSON.stringify(parsed.sources) !== JSON.stringify(expected))
      throw new Error();
    return { version: 1, sources: expected };
  } catch {
    throw new Error('Invalid public source manifest');
  }
}
