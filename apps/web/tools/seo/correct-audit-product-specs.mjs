const appleM3 = 'https://support.apple.com/en-us/117737';
const appleM2 = 'https://support.apple.com/en-us/111838';
const jbl =
  'https://www.jbl.cl/on/demandware.static/-/Sites-masterCatalog_Harman/default/dwec5ad861/pdfs/JBL%20Go%204_%20Specsheet_EN.pdf';
const corrections = {
  'macbook-pro-16-inch-m3-max-2023': {
    key: {
      screen_size_inches: 16.2,
      display_resolution: '3456 x 2234',
      charging_watt: 140,
      weight_g: 2160,
      dimensions_mm: '355.7 x 248.1 x 16.8 mm',
    },
    values: {
      Display: '16.2-inch Liquid Retina XDR display',
      Resolution: '3456 x 2234 at 254 ppi',
      'Unified memory':
        'Listed configurations: 36GB or 48GB; confirm the selected variant.',
      'Battery life':
        'Manufacturer rating: up to 22 hours Apple TV app playback or 15 hours wireless web; actual use varies.',
    },
    extra: [
      [
        'Power adapter',
        'Manufacturer specification: 140W USB-C; confirm supplied accessories for the selected condition.',
      ],
    ],
    source: appleM3,
  },
  'macbook-pro-16-inch-m2-max-2023': {
    key: {
      chipset: 'Apple M2 Max',
      gpu: 'M2 Max 30-core or 38-core GPU; confirm exact configuration',
      cpu_cores: 'M2 Max 12-core CPU',
    },
    values: {
      'Chip options': 'Apple M2 Max',
      'CPU / GPU':
        'M2 Max 12-core CPU; 30-core or 38-core GPU depending on configuration. Confirm the exact unit.',
      'Unified memory': 'Listed configuration: 32GB. Confirm the exact unit.',
      'SSD storage':
        'Listed configuration: 512GB. Confirm the exact device model and storage before purchase; this listing has not been physically verified.',
    },
    source: appleM2,
  },
  'jbl-go-4': {
    key: { battery_mah: 850, dimensions_mm: '94.3 x 75.7 x 42.2' },
    values: { Battery: '850mAh at 3.8V (3.23Wh)' },
    source: jbl,
  },
  'jbl-go-3': {
    key: { battery_mah: null },
    values: {
      Battery:
        'Capacity not verified; confirm the manufacturer specification for the exact model.',
    },
  },
  'airpods-4': {
    key: { weight_g: null, battery_mah: null, chipset: 'Apple H2' },
    values: {
      Battery:
        'Manufacturer rating: up to 5 hours listening on one charge; up to 30 hours with charging case.',
      'Audio platform / chipset': 'Apple H2',
    },
    extra: [
      ['Weight', '4.3g per earbud; 32.3g USB-C charging case'],
      ['Charging case', 'USB-C charging'],
    ],
    source: 'https://support.apple.com/en-us/121203',
  },
  'apple-airpods-4-anc': {
    key: { weight_g: null, battery_mah: null, chipset: 'Apple H2' },
    values: {
      Battery:
        'Manufacturer rating: up to 4 hours listening with ANC enabled, or 5 hours with noise control off; up to 20 or 30 hours respectively with charging case.',
      'Audio platform / chipset': 'Apple H2',
    },
    extra: [
      ['Weight', '4.3g per earbud; 34.7g charging case'],
      [
        'Active noise cancellation',
        'Supported; listening-time ratings depend on noise-control mode.',
      ],
      ['Charging case', 'USB-C, Apple Watch charger or Qi-certified charger'],
    ],
    source: 'https://support.apple.com/en-us/121204',
  },
};

/** Pure, bounded maintenance transform; never changes price, stock or condition. */
export function correctAuditProduct(record) {
  const result = structuredClone(record);
  const correction = corrections[result.slug];
  if (!correction) return result;
  result.key_specs = { ...result.key_specs, ...correction.key };
  result.specifications = result.specifications.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      value: correction.values[item.label] ?? item.value,
    })),
  }));
  if (correction.extra || correction.source) {
    result.specifications = result.specifications.filter(
      (section) =>
        !(
          section.category === 'Verified model references' &&
          section.items.some(
            (item) =>
              item.label === 'Verification basis' &&
              item.value.startsWith(
                'Manufacturer model facts checked 2026-10-25;'
              )
          )
        )
    );
    result.specifications.push({
      category: 'Verified model references',
      items: [
        ...(correction.extra ?? []).map(([label, value]) => ({ label, value })),
        ...(correction.source
          ? [
              { label: 'Manufacturer specification', value: correction.source },
              {
                label: 'Verification basis',
                value:
                  'Manufacturer model facts checked 2026-10-25; this is not a physical inspection or confirmation of supplied accessories.',
              },
            ]
          : []),
      ],
    });
  }
  return result;
}
