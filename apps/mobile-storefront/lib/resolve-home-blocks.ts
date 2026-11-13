import type { Block } from '@/types/blocks';

const DEFAULT_HOME_BLOCKS: Block[] = [
  { type: 'HeroCarousel', props: { id: 'default-hero', slides: [] } },
  { type: 'JustLaunched', props: { id: 'default-just-launched' } },
  {
    type: 'CategoryRail',
    props: { id: 'default-categories', title: 'Shop by Category' },
  },
  {
    type: 'ProductGrid',
    props: {
      id: 'default-products',
      title: 'Featured Products',
      limit: 12,
    },
  },
];

function insertAfterHero(blocks: Block[], injected: Block): Block[] {
  const next = [...blocks];
  const heroIndex = next.findIndex((block) => block.type === 'HeroCarousel');
  if (heroIndex === -1) {
    next.unshift(injected);
  } else {
    next.splice(heroIndex + 1, 0, injected);
  }
  return next;
}

function isBlockArray(content: unknown): content is Block[] {
  return (
    Array.isArray(content) &&
    content.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        typeof item.type === 'string' &&
        'props' in item &&
        typeof item.props === 'object' &&
        item.props !== null &&
        !Array.isArray(item.props) &&
        'id' in item.props &&
        typeof item.props.id === 'string'
    )
  );
}

export function resolveHomeBlocks(
  content: unknown,
  isElite: boolean,
  isInitialLoading: boolean,
  utilitiesInWallet = false
): Block[] {
  if (isInitialLoading) {
    return [];
  }

  let blocks = isBlockArray(content) ? content : DEFAULT_HOME_BLOCKS;

  if (utilitiesInWallet) {
    blocks = blocks.filter((block) => {
      if (block.type !== 'CategoryRail') return true;
      const { slug } = block.props;
      return Boolean(slug && slug !== 'utility' && slug !== 'utilities');
    });
  }

  // Injection order matters: each `insertAfterHero` splices at heroIndex + 1, so
  // a later injection lands *before* an earlier one. JustLaunched is injected
  // first; if CategoryRail is then injected (elite), CategoryRail takes
  // position 1 and pushes JustLaunched to position 2 — final elite order is
  // Hero → CategoryRail → JustLaunched. Keep this order if adding more blocks.

  // Inject the "Just Launched" carousel after the hero for every storefront
  // (idempotent — a merchant-authored config that already includes it wins).
  if (!blocks.some((block) => block.type === 'JustLaunched')) {
    blocks = insertAfterHero(blocks, {
      type: 'JustLaunched',
      props: { id: 'forced-just-launched' },
    });
  }

  // Elite template still forces the utility category rail after the hero.
  if (
    !utilitiesInWallet &&
    isElite &&
    !blocks.some((block) => block.type === 'CategoryRail')
  ) {
    blocks = insertAfterHero(blocks, {
      type: 'CategoryRail',
      props: { id: 'forced-categories', slug: 'utility' },
    });
  }

  return blocks;
}
