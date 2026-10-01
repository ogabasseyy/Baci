import dynamic from 'next/dynamic';

export const FlyToCartAnimation = dynamic(
  () =>
    import('../../components/FlyToCartAnimation').then(
      (mod) => mod.FlyToCartAnimation
    ),
  { loading: () => null, ssr: false }
);
