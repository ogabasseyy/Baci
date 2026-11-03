/**
 * Core game product and console category pattern for product model identification
 * and game product detection. Deliberately excludes gaming accessories.
 */
export const GAME_CATEGORY_PATTERN =
  /^(?:(?:portable-)?gaming|playstation-[45]|nintendo-switch(?:-2)?|xbox)$/u;

/**
 * Commercial guide game category pattern for guide link matching.
 * Includes gaming accessories alongside games and consoles.
 */
export const COMMERCIAL_GUIDE_GAME_CATEGORY_PATTERN =
  /^(?:gaming(?:-accessories)?|portable-gaming|playstation-[45]|nintendo-switch(?:-2)?|xbox)$/u;
