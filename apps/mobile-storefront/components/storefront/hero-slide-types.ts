import type { ImageSource } from 'expo-image';
import type { Href } from 'expo-router';
import type { MobileAdBannerPlacementKey } from '@/config/mobile-ad-placements';

export interface HeroSlide {
  campaign?: 'black-friday';
  artwork?: ImageSource;
  showSavingsProvider?: boolean;
  title: string;
  subtitle: string;
  image: string;
  ctaText: string;
  ctaLink: Href;
}

export interface HeroProps {
  slides?: HeroSlide[];
  autoplayDelay?: number;
  autoplayPaused?: boolean;
  /** Inserts a sponsored slide after the first CMS slide when ads are enabled. */
  trailingAdPlacement?: MobileAdBannerPlacementKey;
}
