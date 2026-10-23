type HeaderRule = {
  headers: Array<{ key: string; value: string }>;
  source: string;
};

export const builderPreviewRouteHeaders: HeaderRule[] = [
  {
    source: '/builder/approve',
    headers: [
      { key: 'Cache-Control', value: 'private, no-store' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ],
  },
  {
    headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
    source: '/template-preview/builder-preview',
  },
];
