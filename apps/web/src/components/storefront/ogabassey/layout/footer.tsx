import type React from 'react';
import type { MerchantData } from '@/hooks/merchant/types';
import { Footer } from '../components/Footer';

interface FooterProps {
  merchant?: MerchantData;
  storeSlug?: string;
}

export const OgabasseyFooter: React.FC<FooterProps> = ({
  merchant,
  storeSlug,
}) => {
  return <Footer merchant={merchant} storeSlug={storeSlug} />;
};
