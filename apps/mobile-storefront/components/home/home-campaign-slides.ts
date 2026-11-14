import type { HeroSlide } from '@/components/storefront/Hero';

export const homeCampaignSlides: readonly HeroSlide[] = [
  {
    title: 'Save for your device',
    subtitle: 'Earn Interest',
    showSavingsProvider: true,
    image: '',
    artwork: require('@/assets/images/campaigns/device-savings.webp'),
    ctaText: 'Explore savings',
    ctaLink: '/wallet',
  },
  {
    title: 'Power cut? Carry on.',
    subtitle: '',
    image: '',
    artwork: require('@/assets/images/campaigns/home-hero-power-tank.webp'),
    ctaText: 'Shop Power Tank',
    ctaLink: { pathname: '/search', params: { q: 'itel Power Tank' } },
  },
  {
    title: 'Capture a moment',
    subtitle: '',
    image: '',
    artwork: require('@/assets/images/campaigns/home-hero-camera.webp'),
    ctaText: 'Shop creator gear',
    ctaLink: { pathname: '/search', params: { q: 'cameras' } },
  },
  {
    title: 'On team Apple?',
    subtitle: '',
    image: '',
    artwork: require('@/assets/images/campaigns/home-hero-apple.webp'),
    ctaText: 'Shop Apple',
    ctaLink: { pathname: '/search', params: { q: 'Apple' } },
  },
  {
    title: 'Quality HeadPhones',
    subtitle: 'Calm your nerves',
    image: '',
    artwork: require('@/assets/images/campaigns/home-hero-audio-portrait.webp'),
    ctaText: 'Shop audio',
    ctaLink: { pathname: '/search', params: { q: 'headphones' } },
  },
];
