import { useBlackFriday } from '@/hooks/use-black-friday';
import { CONFIG } from '@/lib/config';
import type { Block } from '@/types/blocks';

export function useHomeBlackFridayHero(
  headerBlocks: Block[],
  nextDrop: boolean
) {
  const { data, isError, isLoading } = useBlackFriday();
  const heroBlocks = headerBlocks.filter(
    (block) => block.type === 'HeroCarousel'
  );
  const nextDropHero = nextDrop ? heroBlocks[0] : undefined;
  const campaignCandidate =
    CONFIG.MERCHANT_SLUG === 'ogabassey'
      ? (nextDropHero ??
        heroBlocks.find((block) => block.props.slides?.length) ??
        heroBlocks[0])
      : undefined;

  return {
    nextDropHero,
    blackFridayHeroProps: {
      blackFridayHeroBlockId:
        !isError && data?.length ? campaignCandidate?.props.id : undefined,
      pendingBlackFridayHeroBlockId: isLoading
        ? campaignCandidate?.props.id
        : undefined,
    },
  };
}
