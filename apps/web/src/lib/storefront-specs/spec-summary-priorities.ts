export const SUMMARY_SPEC_PRIORITIES = [
  {
    label: 'Display',
    candidates: [
      ['Key Specs', 'Display'],
      ['Key Specs', 'Screen'],
      ['Display', 'Size'],
      ['Display', 'Screen Size'],
      ['Display and monitoring', 'Display'],
      ['Design and handling', 'Display'],
      ['General', 'Display'],
    ],
  },
  {
    label: 'Processor',
    candidates: [
      ['Key Specs', 'Processor'],
      ['Key Specs', 'Chipset'],
      ['Platform', 'Chipset'],
      ['Processing', 'Processor'],
      ['Imaging and recording', 'Processor'],
      ['Camera & Video', 'Processor'],
    ],
  },
  {
    label: 'RAM',
    candidates: [
      ['Memory', 'RAM'],
      ['General', 'RAM'],
    ],
  },
  {
    label: 'Storage',
    candidates: [
      ['Memory', 'Internal Storage'],
      ['General', 'Storage'],
      ['Storage', 'Internal Storage'],
      ['Storage', 'Card Slot'],
      ['Storage and performance', 'Storage'],
      ['Storage and media', 'Media'],
      ['Power, storage and connectivity', 'Storage'],
      ['Connectivity and power', 'Storage'],
    ],
  },
  {
    label: 'Camera',
    candidates: [
      ['Imaging and recording', 'Sensor'],
      ['Camera & Video', 'Sensor'],
      ['Imaging', 'Effective Resolution'],
      ['Compatibility and use', 'Effective Megapixels'],
      ['Key Specs', 'Camera'],
      ['Main Camera', 'Quad Camera'],
      ['Main Camera', 'Triple Camera'],
      ['Main Camera', 'Dual Camera'],
      ['Main Camera', 'Single Camera'],
      ['General', 'Camera'],
    ],
  },
  {
    label: 'Battery',
    candidates: [
      ['Key Specs', 'Battery'],
      ['Battery', 'Capacity'],
      ['General', 'Battery'],
      ['Power', 'Capacity'],
      ['Battery and charging', 'Battery'],
      ['Battery and Build', 'Playback time'],
      ['Power, storage and connectivity', 'Battery'],
    ],
  },
  {
    label: 'SIM',
    candidates: [
      ['Body', 'SIM'],
      ['General', 'SIM'],
    ],
  },
  {
    label: 'OS',
    candidates: [
      ['Key Specs', 'OS'],
      ['Key Specs', 'Operating System'],
      ['Platform', 'OS'],
    ],
  },
] as const;
