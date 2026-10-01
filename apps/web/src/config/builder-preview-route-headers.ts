type HeaderRule = {
  headers: Array<{ key: string; value: string }>;
  source: string;
};

export const builderPreviewRouteHeaders: HeaderRule[] = [
  {
    headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
    source: '/template-preview/builder-preview',
  },
];
