// Nontransparent theme color names: the shadcn palette from
// tailwind.config.mjs plus the storefront tokens from the globals.css
// @theme inline block. All resolve to solid colors (alpha comes only
// from slash modifiers), so any of them overrides inherited
// transparency. Keep in sync when the theme gains colors.
export const THEME_COLOR_NAMES = new Set([
  'foreground',
  'background',
  'border',
  'input',
  'ring',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'destructive',
  'destructive-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'popover',
  'popover-foreground',
  'card',
  'card-foreground',
  'store-primary',
  'store-primary-text',
  'store-on-primary',
  'store-secondary',
  'store-secondary-text',
  'store-accent',
  'store-accent-text',
  'store-background',
  'store-background-text',
  'store-foreground',
  'store-border',
  'store-rating',
  'store-option-secondary',
]);
