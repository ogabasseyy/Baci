import { renderHook } from '@testing-library/react-native';
import type { Block } from '@/types/blocks';
import { useHomeBlackFridayHero } from './use-home-black-friday-hero';

let mockLineup: {
  data?: { id: string }[];
  isLoading?: boolean;
  isError?: boolean;
};
jest.mock('@/hooks/use-black-friday', () => ({
  useBlackFriday: () => mockLineup,
}));
jest.mock('@/lib/config', () => ({ CONFIG: { MERCHANT_SLUG: 'ogabassey' } }));

it('keeps the same hero owner from initial loading through the first populated carousel', () => {
  const blocks = [
    { type: 'HeroCarousel', props: { id: 'hero', slides: [] } },
  ] satisfies Block[];
  mockLineup = { isLoading: true };
  const { result, rerender } = renderHook(() =>
    useHomeBlackFridayHero(blocks, true)
  );
  expect(result.current.blackFridayHeroProps).toEqual({
    pendingBlackFridayHeroBlockId: 'hero',
    blackFridayHeroBlockId: undefined,
  });

  mockLineup = { data: [{ id: 'offer' }] };
  rerender(undefined);
  expect(result.current.blackFridayHeroProps).toEqual({
    pendingBlackFridayHeroBlockId: undefined,
    blackFridayHeroBlockId: 'hero',
  });

  mockLineup = { isError: true, data: [{ id: 'offer' }] };
  rerender(undefined);
  expect(result.current.blackFridayHeroProps).toEqual({
    pendingBlackFridayHeroBlockId: undefined,
    blackFridayHeroBlockId: 'hero',
  });
});
