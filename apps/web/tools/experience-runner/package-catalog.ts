/** Static compiler allowlist, not a promise of browser compatibility. */
export const PACKAGE_CATALOG: Readonly<Record<string, string>> = {
  react: '19.2.3',
  '@baci/experience-sdk': '0.0.1',
  '@baci/shared': '0.0.1',
  'react-dom': '19.2.3',
  'framer-motion': '12.40.0',
  scheduler: '0.27.0',
  'motion-dom': '12.40.0',
  'motion-utils': '12.39.0',
};
export const AUTHORED_PACKAGES = [
  'react',
  'react-dom',
  '@baci/experience-sdk',
  'framer-motion',
] as const;
