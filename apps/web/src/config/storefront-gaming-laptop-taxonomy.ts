export const DEDICATED_GAMING_LAPTOP_TOKENS = [
  'alienware',
  'aorus',
  'blade',
  'geforce',
  'katana',
  'legion',
  'nitro',
  'omen',
  'predator',
  'rog',
  'rtx',
  'tuf',
] as const;

export const EXCLUDED_HANDHELD_TOKENS = [
  'handheld',
  'steam deck',
  'rog ally',
] as const;

export const NON_EXEMPT_KEYBOARD_PHRASES = [
  'gaming keyboard',
  'gaming keyboards',
  'laptop keyboard',
  'laptop keyboards',
] as const;

export const NON_EXEMPT_GPU_PHRASES = [
  'gaming laptop gpu',
  'gaming laptop graphics card',
] as const;

export const NON_EXEMPT_MONITOR_PHRASES = [
  'monitor for',
  'monitors for',
] as const;

export const GAMING_LAPTOP_EXEMPT_PHRASES = {
  desktop: ['desktop replacement', 'desktop-class'],
  monitor: ['pairing', 'pairings', 'paired'],
  accessories: [
    'with free accessories',
    'with accessories',
    'bundled accessories',
  ],
  battery: ['battery life', 'battery test', 'battery performance'],
} as const;

export const EXCLUDED_GAMING_LAPTOP_SUBJECTS = [
  'accessories',
  'accessory',
  'aurora',
  'cooling pad',
  'cooling pads',
  'desktop',
  'desktops',
  'docking station',
  'docking stations',
  'gaming dock',
  'gaming docks',
  'gaming keyboard',
  'gaming keyboards',
  'gaming stand',
  'gaming stands',
  'gpu',
  'gpus',
  'graphics card',
  'graphics cards',
  'handheld',
  'handhelds',
  'keyboard',
  'keyboards',
  'laptop adapter',
  'laptop adapters',
  'laptop backpack',
  'laptop backpacks',
  'laptop batteries',
  'laptop battery',
  'laptop charger',
  'laptop chargers',
  'laptop dock',
  'laptop docks',
  'laptop keyboard',
  'laptop keyboards',
  'laptop skin',
  'laptop skins',
  'laptop sleeve',
  'laptop sleeves',
  'laptop stand',
  'laptop stands',
  'monitor',
  'monitors',
  'pc build',
  'pc builds',
  'power adapter',
  'power adapters',
  'rog ally',
  'steam deck',
] as const;

export const EXCLUDED_CATEGORY_MAP = [
  ['monitors', ['monitor', 'monitors']],
  ['desktops', ['desktop', 'desktops', 'aurora', 'pc build', 'pc builds']],
  [
    'gaming',
    [
      'gpu',
      'gpus',
      'graphics card',
      'graphics cards',
      'rog ally',
      'steam deck',
      'handheld',
      'handhelds',
    ],
  ],
] as const;
