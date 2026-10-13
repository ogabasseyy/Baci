/** Shared prop types for hero slide variants. */
import type { useTheme } from '@/hooks/useTheme';
import type { getHeroStyles } from './Hero.styles';

export type HeroThemeColors = ReturnType<typeof useTheme>['colors'];
export type HeroVariantStyles = ReturnType<typeof getHeroStyles>;
