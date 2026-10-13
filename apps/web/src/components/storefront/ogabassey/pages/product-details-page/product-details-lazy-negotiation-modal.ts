import dynamic from 'next/dynamic';

export const NegotiationModal = dynamic(
  () =>
    import('../../components/NegotiationModal').then((mod) => mod.NegotiationModal),
  { loading: () => null, ssr: false }
);
