import dynamic from 'next/dynamic';

export const SelectionRequiredModal = dynamic(
  () =>
    import('./selection-required-modal').then((mod) => mod.SelectionRequiredModal),
  { loading: () => null, ssr: false }
);
