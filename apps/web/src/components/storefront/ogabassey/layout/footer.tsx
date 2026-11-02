'use client';

import type React from 'react';
import type { MerchantData } from '@/hooks/merchant/types';
import { Footer } from '../components/Footer';

export interface FooterProps {
  merchant?: MerchantData;
  storeSlug?: string;
}

const DEFAULT_OGABASSEY_FOOTER_MERCHANT: MerchantData = {
  id: 'ogabassey-default',
  user_id: 'ogabassey-default',
  business_name: 'Ogabassey',
  business_type: 'electronics',
  email: 'support@ogabassey.com',
  phone: '+234 814 697 8921',
  business_address: '2 Olaide Tomori St, Ikeja, Lagos',
  social_media: {
    instagram: 'https://instagram.com/ogabasseyy',
    facebook: 'https://www.facebook.com/ogabasseyyy',
    tiktok: 'https://www.tiktok.com/@ogabasseyy',
    twitter: 'https://x.com/ogabasseyy',
    youtube: 'https://www.youtube.com/@ogabassey',
    linkedin: 'https://www.linkedin.com/company/ogabasseyy/',
  },
};

export const OgabasseyFooter: React.FC<FooterProps> = ({
  merchant = DEFAULT_OGABASSEY_FOOTER_MERCHANT,
  storeSlug,
}) => {
  return <Footer merchant={merchant} storeSlug={storeSlug} />;
};
