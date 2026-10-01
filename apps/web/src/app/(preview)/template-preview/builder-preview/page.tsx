import type { Metadata } from 'next';
import { BuilderPreviewCanvas } from './builder-preview-canvas';

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
};

export default function BuilderPreviewPage() {
  return <BuilderPreviewCanvas />;
}
