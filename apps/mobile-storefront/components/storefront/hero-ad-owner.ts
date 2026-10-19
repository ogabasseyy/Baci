import type { Block, HeroCarouselBlock } from '@/types/blocks';

/**
 * Single HOME_STRIP owner across the whole page. The feed renders one
 * BlockRenderer per slice (header/footer), so each slice cannot elect its
 * own owner: two heroes on opposite sides of the product grid would each
 * claim index 0 and request the same logical placement concurrently.
 * Returns the first hero block with slides in visual order, or null.
 */
export function findHeroAdOwnerBlockId(blocks: Block[]): string | null {
  for (const block of blocks) {
    if (block.type !== 'HeroCarousel') continue;
    const slides = (block as HeroCarouselBlock).props.slides;
    if (Array.isArray(slides) && slides.length > 0) {
      return (block as HeroCarouselBlock).props.id;
    }
  }
  return null;
}
