export const DEDICATED_GAMING_LAPTOP_TOKENS = [
  'alienware',
  'aorus',
  'blade',
  'crosshair',
  'geforce',
  'katana',
  'legion',
  'nitro',
  'omen',
  'predator',
  'raider',
  'rog',
  'rtx',
  'stealth',
  'titan',
  'tuf',
  'vector',
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
  'gaming laptop gpus',
  'gaming laptop graphics card',
  'gaming laptop graphics cards',
  'gpu for gaming laptop',
  'gpu for gaming laptops',
  'gpus for gaming laptop',
  'gpus for gaming laptops',
  'graphics card for gaming laptop',
  'graphics card for gaming laptops',
  'graphics cards for gaming laptop',
  'graphics cards for gaming laptops',
] as const;

export const AMBIGUOUS_FAMILY_ALIAS_PARENT: Readonly<Record<string, string>> = {
  blade: 'razer',
  predator: 'acer',
  nitro: 'acer',
  katana: 'msi',
  stealth: 'msi',
  titan: 'msi',
  raider: 'msi',
  vector: 'msi',
  crosshair: 'msi',
};

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
