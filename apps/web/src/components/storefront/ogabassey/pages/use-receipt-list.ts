import type { ReceiptMerchant, ReceiptOrder } from '@baci/shared';
import { useEffect, useState } from 'react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import {
  fetchReceiptListItems,
  type ReceiptListItem,
} from './receipt-list-items';

export function useReceiptList() {
  const { customer, isAuthenticated } = useCustomerAuth();
  const merchantContext = useMerchantSafe();

  const [searchQuery, setSearchQuery] = useState('');
  const [receipts, setReceipts] = useState<ReceiptListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<ReceiptOrder | null>(null);
  const [selectedDocumentKind, setSelectedDocumentKind] =
    useState<'proforma' | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch orders
  useEffect(() => {
    const fetchOrders = () => {
      if (!isAuthenticated || !merchantContext?.merchant?.slug) {
        setIsLoading(false);
        return;
      }

      fetchReceiptListItems(merchantContext.merchant.slug, customer)
        .then((mapped) => {
          if (mapped) {
            setReceipts(mapped);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch receipts', err);
        })
        .finally(() => {
          setIsLoading(false);
        });
    };

    fetchOrders();
  }, [isAuthenticated, merchantContext?.merchant?.slug, customer]);

  // Derive merchant receipt data from context during render
  const m = merchantContext?.merchant;
  const shouldShowOgabasseyAppBanner = m?.slug === 'ogabassey';
  const merchantReceiptData: ReceiptMerchant | null = m
    ? {
        business_name: m.business_name || null,
        logo_url: m.logo_url || null,
        email: m.email || '',
        phone: m.phone || null,
        support_email: m.support_email || null,
        support_phone: m.support_phone || null,
        business_address: m.business_address || null,
        cac_rc_number: null,
        tax_identification_number: null,
        legal_entity_name: null,
        brand_colors: m.brand_colors,
        vat_registration_status: m.vat_registration_status || null,
        vat_rate: m.vat_rate ?? null,
        bank_code: null,
        bank_account_number: null,
        bank_name: null,
        bank_account_name: null,
        social_media: m.social_media,
        pages: m.pages,
      }
    : null;

  const filteredReceipts = receipts.filter((receipt) => {
    const query = searchQuery.toLowerCase();
    return (
      receipt.order_number.toLowerCase().includes(query) ||
      receipt.firstProductName.toLowerCase().includes(query) ||
      receipt.status.toLowerCase().includes(query)
    );
  });

  const handleViewReceipt = (receipt: ReceiptListItem) => {
    setSelectedOrder(receipt.rawOrder);
    setSelectedDocumentKind(receipt.documentKind);
    setIsModalOpen(true);
  };

  return {
    filteredReceipts,
    handleViewReceipt,
    isAuthenticated,
    isLoading,
    isModalOpen,
    merchantReceiptData,
    searchQuery,
    selectedDocumentKind,
    selectedOrder,
    setIsModalOpen,
    setSearchQuery,
    shouldShowOgabasseyAppBanner,
  };
}
