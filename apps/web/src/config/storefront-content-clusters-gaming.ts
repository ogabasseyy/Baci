import type { ClusterSupport } from './storefront-content-cluster-shared';

const gamingBrands = {
  asus: ['asus', 'rog'],
  playstation: ['playstation', 'ps5', 'ps4', 'sony'],
  nintendo: ['nintendo', 'switch'],
  xbox: ['xbox', 'microsoft'],
  steam: ['steam'],
  gaming: ['gaming', 'game'],
} as const;

export const GAMING_CONTENT_CLUSTER_SUPPORT = {
  gaming: {
    categoryNames: ['gaming', 'games', 'consoles'],
    articleTokens: [
      'gaming',
      'game',
      'console',
      'controller',
      'playstation',
      'ps5',
      'ps4',
      'nintendo',
      'switch',
      'xbox',
    ],
    brandTokens: gamingBrands,
    priceBandAliases: {
      'under-500k': ['budget', 'used', 'disc'],
      'under-1m': ['console', 'bundle'],
    },
  },
  'playstation-5': {
    categoryNames: ['playstation 5', 'ps5'],
    articleTokens: [
      'playstation',
      'ps5',
      'dualsense',
      'console',
      'disc edition',
      'digital edition',
      'game',
    ],
    brandTokens: gamingBrands,
    priceBandAliases: { 'under-1m': ['console', 'bundle', 'used'] },
  },
  'playstation-4': {
    categoryNames: ['playstation 4', 'ps4'],
    articleTokens: [
      'playstation',
      'ps4',
      'dualshock',
      'console',
      'game',
      'disc',
    ],
    brandTokens: gamingBrands,
    priceBandAliases: { 'under-500k': ['budget', 'used', 'disc'] },
  },
  'nintendo-switch': {
    categoryNames: ['nintendo switch', 'switch'],
    articleTokens: [
      'nintendo',
      'switch',
      'oled',
      'lite',
      'joy-con',
      'mario',
      'zelda',
      'portable gaming',
    ],
    brandTokens: gamingBrands,
    priceBandAliases: {
      'under-500k': ['switch lite', 'used'],
      'under-1m': ['oled', 'bundle'],
    },
  },
  'nintendo-switch-2': {
    categoryNames: ['nintendo switch 2', 'switch 2'],
    articleTokens: ['nintendo', 'switch 2', 'joy-con', 'portable gaming'],
    brandTokens: gamingBrands,
    priceBandAliases: { 'under-1m': ['console', 'bundle'] },
  },
  'portable-gaming': {
    categoryNames: ['portable gaming', 'handheld gaming'],
    articleTokens: [
      'portable gaming',
      'handheld',
      'switch',
      'steam deck',
      'rog ally',
    ],
    brandTokens: gamingBrands,
    priceBandAliases: { 'under-1m': ['handheld', 'portable'] },
  },
  xbox: {
    categoryNames: ['xbox', 'xbox series'],
    articleTokens: ['xbox', 'series s', 'series x', 'game pass', 'controller'],
    brandTokens: gamingBrands,
    priceBandAliases: { 'under-1m': ['console', 'bundle'] },
  },
  'gift-cards': {
    categoryNames: ['gift cards', 'gift-cards', 'digital cards'],
    articleTokens: [
      'gift card',
      'steam card',
      'itunes',
      'wallet',
      'redemption',
      'region',
      'code',
    ],
    brandTokens: {
      steam: ['steam'],
      apple: ['apple', 'itunes'],
      playstation: ['playstation', 'psn'],
      xbox: ['xbox'],
      google: ['google play'],
    },
    priceBandAliases: {},
  },
} satisfies Record<string, ClusterSupport>;
