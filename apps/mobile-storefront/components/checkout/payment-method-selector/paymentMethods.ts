import creditDirectLogoSource from '@/assets/images/creditdirect.jpg';
import credpalLogoSource from '@/assets/images/credpal.png';
import type { PaymentMethod } from './types';

export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'paystack',
    label: 'Pay with Card',
    description: 'Visa, Mastercard, Verve',
    icon: 'card-outline',
    tab: 'full',
  },
  {
    // Korapay is the alternate card gateway. Without this row a Korapay-only
    // merchant (paystack disabled) renders an empty payment selector, because
    // the selector only shows methods present in this list.
    id: 'korapay',
    label: 'Pay with Card',
    description: 'Visa, Mastercard, Verve',
    icon: 'card-outline',
    tab: 'full',
  },
  {
    id: 'bank_transfer',
    label: 'Bank Transfer',
    description: 'Pay via direct bank transfer',
    icon: 'business-outline',
    tab: 'full',
  },
  {
    id: 'pay_on_delivery',
    label: 'Pay on Delivery',
    description: 'Cash or POS on delivery',
    icon: 'cash-outline',
    tab: 'full',
  },
  {
    id: 'juicyway',
    label: 'Pay with Crypto',
    description: 'USDT, USDC via Juicyway',
    icon: 'logo-bitcoin',
    tab: 'full',
  },
  {
    id: 'credit_direct',
    label: 'Credit Direct',
    description: 'Salary Earners and Business Owners',
    icon: 'wallet-outline',
    tab: 'installments',
    logoUrl: creditDirectLogoSource,
  },
  {
    id: 'credpal',
    label: 'CredPal',
    description: 'Salary Earners Only',
    icon: 'calendar-outline',
    tab: 'installments',
    logoUrl: credpalLogoSource,
  },
  {
    id: 'klump',
    label: 'Klump',
    description: 'Buy now, pay in installments',
    icon: 'wallet-outline',
    tab: 'installments',
  },
  {
    id: 'invoice',
    label: 'Get a Proforma Invoice',
    description: 'Send it to your company',
    icon: 'receipt-outline',
    tab: 'pay_later',
  },
  {
    id: 'payforme',
    label: 'Pay for Me',
    description: 'Create a payment request someone else can settle',
    icon: 'people-outline',
    tab: 'pay_later',
  },
];
