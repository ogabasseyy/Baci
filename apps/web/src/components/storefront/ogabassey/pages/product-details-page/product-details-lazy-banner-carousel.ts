import dynamic from 'next/dynamic';

export const BannerCarousel = dynamic(
  () =>
    import('../../components/BannerCarousel').then((mod) => mod.BannerCarousel),
  { loading: () => null, ssr: false }
);
