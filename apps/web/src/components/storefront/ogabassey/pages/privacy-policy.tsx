// Server Component (no 'use client'): this page is purely presentational — no hooks,
// state, or event handlers — so it renders on the server. That keeps the SafeHtml /
// sanitize-html sanitizer out of the route's client bundle (render-weight reduction)
// and lets the sanitized policy HTML paint in the SSR document instead of hydrating.
// Do not add 'use client' here without introducing real interactivity.
import type { MerchantData } from '@/hooks/merchant/types';

import {
  Cookie,
  Database,
  Eye,
  Lock,
  Mail,
  Share2,
  Shield,
} from 'lucide-react';
import type React from 'react';
import { SafeHtml } from '@/components/ui/safe-html';

// Define props
interface PrivacyProps {
  merchant?: Partial<MerchantData>;
}

export const OgabasseyV2PrivacyPolicy: React.FC<PrivacyProps> = ({ merchant }) => {
  const businessName = merchant?.business_name || 'Ogabassey Limited';
  const email = merchant?.email || 'support@ogabassey.com';
  const address = merchant?.business_address || 'Lagos, Nigeria';
  const customContent = merchant?.pages?.privacy;
  const isOgabassey = merchant?.slug === 'ogabassey';

  const sections = [
    {
      title: 'Information We Collect',
      icon: Database,
      content: (
        <>
          <p className="mb-4">
            We collect information to provide better services to all our users.
            This includes:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-gray-600">
            <li>
              <strong>Personal Information:</strong> Name, email address, phone
              number, and shipping address provided during checkout or account
              creation.
            </li>
            <li>
              <strong>Payment Information:</strong> We do not store your credit
              card details. All transactions are processed securely through our
              payment partners.
            </li>
            <li>
              <strong>Usage Data:</strong> Information about how you use our
              website, such as products viewed, search queries, and device
              information.
            </li>
          </ul>
        </>
      ),
    },
    // ... (Keep other sections generic or slightly adjusted)
    {
      title: 'How We Use Your Information',
      icon: Eye,
      content: (
        <>
          <p className="mb-4">
            We use the information we collect for the following purposes:
          </p>
          <ul className="list-disc pl-5 space-y-2 text-gray-600">
            <li>
              To process and fulfill your orders, including sending emails to
              confirm your order status and shipment.
            </li>
            <li>
              To communicate with you about products, services, offers,
              promotions, and rewards.
            </li>
            <li>
              To improve our website functionality and user experience based on
              usage patterns.
            </li>
            <li>To detect and prevent fraud, abuse, and security incidents.</li>
          </ul>
        </>
      ),
    },
    {
      title: 'Data Security',
      icon: Lock,
      content: (
        <p>
          We implement a variety of security measures to maintain the safety of
          your personal information. Your personal data is contained behind
          secured networks and is only accessible by a limited number of persons
          who have special access rights to such systems.
        </p>
      ),
    },
    {
      title: 'Sharing Your Information',
      icon: Share2,
      content: isOgabassey ? (
        <p>
          We share only the information needed with our hosting and database
          providers, payment processors, delivery partners, and support providers
          to run the store and fulfil orders. When you use our ChatGPT app,
          OpenAI processes your conversation under its own privacy terms and
          sends us the tool inputs needed to answer your request. We do not sell
          your personal information.
        </p>
      ) : (
        <p>
          We do not sell, trade, or otherwise transfer to outside parties your
          Personally Identifiable Information unless we provide users with
          advance notice.
        </p>
      ),
    },
    {
      title: 'Cookies',
      icon: Cookie,
      content: (
        <p>
          Yes, we use cookies. Cookies are small files that a site or its
          service provider transfers to your computer&apos;s hard drive through
          your Web browser (if you allow) that enables the site&apos;s or
          service provider&apos;s systems to recognize your browser and capture
          and remember certain information.
        </p>
      ),
    },
    ...(isOgabassey
      ? [
          {
            title: 'How Long We Keep Your Information',
            icon: Database,
            content: (
              <div className="space-y-3">
                <p>
                  We keep account and contact details while they are needed to
                  provide your account, fulfil orders, and handle support. When
                  that purpose ends, we delete or de-identify personal data no
                  later than six calendar months afterwards unless a law or a
                  legal claim requires us to keep specific records longer.
                </p>
                <p>
                  Tax-relevant accounting and transaction records are kept for
                  at least six years after the year of assessment to which they
                  relate, as required by section 31(5) of the Nigeria Tax
                  Administration Act, 2025. We limit access to records kept for
                  legal purposes and delete or de-identify them when that basis
                  ends.
                </p>
                <p>
                  Catalog searches in our ChatGPT app do not create a saved
                  Ogabassey account search history. Our server processes the
                  tool request to return products; ChatGPT controls the
                  retention of your conversation under OpenAI&apos;s own policy.
                </p>
              </div>
            ),
          },
          {
            title: 'Your Privacy Choices',
            icon: Eye,
            content: (
              <p>
                You can ask us to access, correct, or delete your personal
                information, or object to or restrict processing where the law
                allows. You can also withdraw consent for optional processing.
                Email us at <a href={`mailto:${email}`} className="underline">{email}</a>
                {' '}from your registered address so we can verify your request.
                We may retain the minimum records required for tax, disputes,
                fraud prevention, or other legal obligations and will explain
                any limit that applies to your request.
              </p>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-[#1a1a1a] text-white py-16 md:py-20 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/security.png')]" />
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 relative z-10 text-center">
          <div className="size-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-6 backdrop-blur-xs border border-white/10">
            <Shield size={32} className="text-red-500" />
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold mb-4 tracking-tight">
            Privacy Policy
          </h1>
          <p className="text-gray-400 text-sm md:text-base max-w-2xl mx-auto">
            Protecting your data and trust.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-6 -mt-10 relative z-20">
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 md:p-12 space-y-12">

          {customContent ? (
            <SafeHtml html={customContent} className="prose max-w-none" />
          ) : (
            <>
              <div className="prose max-w-none text-gray-600">
                <p className="lead text-lg">
                  At <strong>{businessName}</strong>, one of our main priorities is the privacy of our
                  visitors. This Privacy Policy document contains types of
                  information that is collected and recorded by us and how we
                  use it.
                </p>
              </div>

              <div className="space-y-10">
                {sections.map((section) => (
                  <div key={section.title} className="flex gap-4 md:gap-6">
                    <div className="shrink-0">
                      <div className="w-10 h-10 md:w-12 md:h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center border border-red-100">
                        <section.icon size={20} />
                      </div>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-3">
                        {section.title}
                      </h2>
                      <div className="text-gray-600 text-sm md:text-base leading-relaxed">
                        {section.content}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 mt-8">
            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Mail className="text-red-600" size={20} />
              Contact Us regarding Privacy
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              If you have any questions about this Privacy Policy, please contact us at:
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href={`mailto:${email}`}
                className="text-red-600 font-bold hover:underline"
              >
                {email}
              </a>
              <span className="hidden sm:inline text-gray-300">|</span>
              <span className="text-gray-700 font-medium">
                {address}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
