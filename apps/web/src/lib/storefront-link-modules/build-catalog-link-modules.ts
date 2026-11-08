import type { StorefrontLinkModule } from './link-module-types';
import {
  dedupeLinkModuleItems,
  pruneEmptyLinkModules,
} from './link-module-utils';

interface LinkModuleInput {
  href: string;
  label: string;
}

export interface BuildCatalogLinkModulesInput {
  compareLinks: LinkModuleInput[];
  editorialLinks: LinkModuleInput[];
}

export function buildCatalogLinkModules({
  compareLinks,
  editorialLinks,
}: BuildCatalogLinkModulesInput): StorefrontLinkModule[] {
  return pruneEmptyLinkModules([
    {
      id: 'compare-modules',
      title: 'Compare products',
      description:
        'Use maintained comparison pages for common buying decisions.',
      items: dedupeLinkModuleItems(
        compareLinks.map((link) => ({
          ...link,
          source: 'compare',
        }))
      ),
    },
    {
      id: 'editorial-guides',
      title: 'Buying guides',
      description: 'Read maintained guides that support product research.',
      items: dedupeLinkModuleItems(
        editorialLinks.map((link) => ({
          ...link,
          source: 'editorial',
        }))
      ),
    },
  ]);
}
