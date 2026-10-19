import dynamic from 'next/dynamic';

export const AdUnit = dynamic(
  () => import('../../components/AdUnit').then((mod) => mod.AdUnit),
  { loading: () => null, ssr: false }
);
