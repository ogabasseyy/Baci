'use client';

import {
  ChevronDown,
  ChevronUp,
  CreditCard,
  ExternalLink,
  HelpCircle,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Smartphone,
  Truck,
} from 'lucide-react';
import { parseLegacyFAQ, type FAQItem } from '@/types/faq';
import type React from 'react';
import { useState } from 'react';

interface FaqItem {
  question: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  {
    question: 'How do I track my order?',
    answer:
      "You can track your order by visiting the 'My Orders' section in your profile. Click on the specific order to see real-time status updates and tracking numbers if available.",
  },
  {
    question: 'What is your return policy?',
    answer:
      'We offer a 7-day return policy for defective items. The device must be in its original condition with all accessories. Please visit our Returns page for the full policy and to initiate a return.',
  },
  {
    question: 'How does the warranty work?',
    answer:
      'All new devices come with a standard 1-year manufacturer warranty. Used devices come with a 3-month warranty covering technical faults. Physical and liquid damage are not covered unless you purchased additional protection.',
  },
  {
    question: 'Do you offer installment payments?',
    answer:
      "Yes, we partner with selected financial institutions to offer 'Buy Now, Pay Later' options. You can select this option at checkout if you are eligible.",
  },
  {
    question: 'Can I swap my old phone?',
    answer:
      "Absolutely! Use our 'Swap & Trade-in' feature to get an estimated value for your current device. You can use this value as a discount towards your new purchase.",
  },
];

interface MerchantInfo {
  business_name?: string;
  email?: string;
  support_email?: string;
  support_phone?: string;
  phone?: string;
  address?: string;
  faq_items?: { question: string; answer: string }[];
  pages?: { faq?: string };
}

interface HelpProps {
  merchant?: MerchantInfo;
}

export const OgabasseyV2HelpSupport: React.FC<HelpProps> = ({ merchant }) => {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const businessName = merchant?.business_name || 'Ogabassey';
  const email =
    merchant?.support_email?.trim() ||
    merchant?.email?.trim() ||
    'support@ogabassey.com';
  const phone =
    merchant?.support_phone?.trim() ||
    merchant?.phone?.trim() ||
    '+234 814 697 8921';
  const address = merchant?.address || 'Lagos, Nigeria';

  // Get FAQs from structured items or legacy content
  let displayFaqs: FaqItem[] = [];

  if (merchant?.faq_items && merchant.faq_items.length > 0) {
    displayFaqs = merchant.faq_items;
  } else if (merchant?.pages?.faq) {
    displayFaqs = parseLegacyFAQ(merchant.pages.faq);
  } else {
    // Default FAQs if no content exists
    displayFaqs = FAQS;
  }

  const toggleFaq = (index: number) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  const filteredFaqs = displayFaqs.filter(
    (faq) =>
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 pb-24 md:pb-12 pt-4 md:pt-8 flex flex-col">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 w-full flex-1 flex flex-col">
        {/* Header */}
        <div className="text-center mb-10 max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-4 flex items-center justify-center gap-3">
            <HelpCircle className="text-red-600 fill-red-600/10" size={32} />
            Help Center
          </h1>
          <p className="text-gray-500 mb-8">
            Find answers to your questions or get in touch with our support
            team.
          </p>

          {/* Search Bar */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`How can we help you today, ${businessName} customer?`}
              aria-label="Search help articles"
              className="w-full pl-12 pr-4 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm focus:outline-hidden focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all text-base"
            />
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
              size={20}
            />
          </div>
        </div>

        {/* Quick Topics */}
        <div className="mb-12">
          <h2 className="text-lg font-bold text-gray-900 mb-4">
            Popular Topics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                icon: Truck,
                label: 'Track Order',
                color: 'text-blue-600',
                bg: 'bg-blue-50',
              },
              {
                icon: RefreshCw,
                label: 'Returns',
                color: 'text-orange-600',
                bg: 'bg-orange-50',
              },
              {
                icon: CreditCard,
                label: 'Payments',
                color: 'text-green-600',
                bg: 'bg-green-50',
              },
              {
                icon: Smartphone,
                label: 'Product Guide',
                color: 'text-purple-600',
                bg: 'bg-purple-50',
              },
            ].map((topic, _idx) => (
              <button
                type="button"
                key={topic.label}
                className="bg-white p-6 rounded-2xl border border-gray-100 hover:shadow-md transition-all flex flex-col items-center justify-center gap-3 text-center group"
              >
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center ${topic.bg} ${topic.color} group-hover:scale-110 transition-transform`}
                >
                  <topic.icon size={24} />
                </div>
                <span className="font-bold text-gray-700 text-sm">
                  {topic.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* FAQs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              Frequently Asked Questions
            </h2>
            <div className="space-y-4">
              {filteredFaqs.length > 0 ? (
                filteredFaqs.map((faq, index) => (
                  <div
                    key={faq.question}
                    className="bg-white rounded-xl border border-gray-100 overflow-hidden transition-all"
                  >
                    <button
                      type="button"
                      onClick={() => toggleFaq(index)}
                      className="w-full flex items-center justify-between p-5 text-left bg-white hover:bg-gray-50 transition-colors"
                    >
                      <span className="font-bold text-gray-800 text-sm md:text-base">
                        {faq.question}
                      </span>
                      {openFaqIndex === index ? (
                        <ChevronUp className="text-red-600" size={20} />
                      ) : (
                        <ChevronDown className="text-gray-400" size={20} />
                      )}
                    </button>
                    {openFaqIndex === index && (
                      <div className="p-5 pt-0 text-sm text-gray-600 leading-relaxed border-t border-gray-50 bg-gray-50/30">
                        {faq.answer}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="text-center py-8 bg-white rounded-xl border border-gray-100">
                  <p className="text-gray-500">No matching questions found.</p>
                </div>
              )}
            </div>
          </div>

          {/* Contact Options */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-6">
              <div className="bg-[#1a1a1a] text-white rounded-2xl p-6 shadow-lg relative overflow-hidden">
                <div className="relative z-10">
                  <h3 className="text-xl font-bold mb-2">Still need help?</h3>
                  <p className="text-gray-400 text-sm mb-6">
                    Our support team is available Mon - Sat, 9am to 6pm.
                  </p>

                  <div className="space-y-3">
                    <a
                      href={`tel:${phone.replace(/\s/g, '')}`}
                      className="flex items-center gap-3 p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/5"
                    >
                      <Phone size={18} className="text-red-500" />
                      <span className="font-medium text-sm">
                        {phone}
                      </span>
                    </a>
                    <a
                      href={`mailto:${email}`}
                      className="flex items-center gap-3 p-3 bg-white/10 rounded-xl hover:bg-white/20 transition-colors border border-white/5"
                    >
                      <Mail size={18} className="text-red-500" />
                      <span className="font-medium text-sm">
                        {email}
                      </span>
                    </a>
                    <button
                      type="button"
                      disabled
                      className="w-full flex items-center justify-center gap-2 p-3 bg-gray-400 text-white rounded-xl font-bold text-sm transition-colors mt-2 cursor-not-allowed"
                    >
                      <MessageSquare size={18} />
                      Live Chat (Coming Soon)
                    </button>
                  </div>
                </div>
                {/* Decoration */}
                <div className="absolute -top-10 -right-10 size-32 bg-red-600 rounded-full blur-3xl opacity-20" />
              </div>

              <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                <h3 className="font-bold text-gray-900 mb-3 text-sm">
                  Visit our Office
                </h3>
                <div className="flex gap-3 text-sm text-gray-600">
                  <div className="mt-1">
                    <ExternalLink size={16} className="text-gray-400" />
                  </div>
                  <p>
                    {address}
                  </p>
                </div>
                <a
                  href="https://maps.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-4 text-xs font-bold text-red-600 hover:underline"
                >
                  Get Directions
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
