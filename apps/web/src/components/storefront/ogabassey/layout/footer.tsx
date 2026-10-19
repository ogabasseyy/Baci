// Template preview

import {
  Apple,
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Music,
  Phone,
  Twitter,
  Youtube,
} from 'lucide-react';
import Link from 'next/link';
import type React from 'react';

// import { Logo } from './Logo'; // Replaced
import { Logo } from './logo';
import { asRoute } from '@/lib/routes';

interface FooterProps {
  storeSlug?: string;
  logo?: string;
}

export const OgabasseyFooter: React.FC<FooterProps> = ({ storeSlug, logo }) => {
  // Helper to generate store-relative URLs
  const getUrl = (path: string) => `${storeSlug || ''}${path}`;

  return (
    <footer className="bg-[#1a1a1a] text-white pt-10 pb-32 md:pb-10 relative overflow-hidden font-sans border-t border-gray-800">
      {/* Pattern Overlay - Same as Navbar */}
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='150' height='150' viewBox='0 0 150 150' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='1.5'%3E%3C!-- Original items --%3E%3Cg transform='translate(20, 20) rotate(-15 6 10)'%3E%3Crect x='0' y='0' width='12' height='20' rx='2'/%3E%3Cline x1='4' y1='17' x2='8' y2='17' stroke-width='1'/%3E%3C/g%3E%3Cg transform='translate(90, 15) rotate(10 10 7)'%3E%3Cpath d='M2 0 h16 v10 h-16 z M0 10 h20 v2 h-20 z'/%3E%3C/g%3E%3Cg transform='translate(25, 80) rotate(20 8 8)'%3E%3Cpath d='M0 10 v5 h4 v-5 a6 6 0 1 1 12 0 v5 h4 v-5'/%3E%3C/g%3E%3Cg transform='translate(75, 100) rotate(-10 6 6)'%3E%3Crect x='0' y='0' width='12' height='12' rx='3'/%3E%3Cpath d='M3 -3 v3 M9 -3 v3 M3 12 v3 M9 12 v3'/%3E%3C/g%3E%3Cg transform='translate(120, 90) rotate(5 9 6)'%3E%3Crect x='0' y='3' width='18' height='12' rx='2'/%3E%3Ccircle cx='9' cy='9' r='3'/%3E%3Crect x='2' y='0' width='4' height='3' rx='1'/%3E%3C/g%3E%3Cg transform='translate(70, 50) rotate(-25 10 6)'%3E%3Crect x='0' y='0' width='20' height='12' rx='6'/%3E%3Ccircle cx='6' cy='6' r='2'/%3E%3Ccircle cx='14' cy='6' r='2'/%3E%3C/g%3E%3Cg transform='translate(120, 40) rotate(35 8 10)'%3E%3Crect x='0' y='0' width='16' height='20' rx='2'/%3E%3C/g%3E%3C!-- New items for density --%3E%3Cg transform='translate(50, 15) rotate(45 5 5)'%3E%3Crect x='2' y='-2' width='6' height='14' rx='1'/%3E%3Crect x='0' y='2' width='10' height='6' rx='2'/%3E%3C/g%3E%3Cg transform='translate(10, 55) rotate(15 5 8)'%3E%3Crect x='0' y='0' width='10' height='16' rx='5'/%3E%3Cline x1='5' y1='0' x2='5' y2='6'/%3E%3C/g%3E%3Cg transform='translate(45, 115) rotate(-10 6 8)'%3E%3Crect x='0' y='0' width='12' height='16' rx='1'/%3E%3Ccircle cx='6' cy='4' r='2'/%3E%3Ccircle cx='6' cy='11' r='3'/%3E%3C/g%3E%3Cg transform='translate(100, 75) rotate(30 6 6)'%3E%3Crect x='0' y='4' width='12' height='8' rx='2'/%3E%3Cpath d='M2 4 v-4 M10 4 v-4'/%3E%3C/g%3E%3Cg transform='translate(135, 125) rotate(-45 5 9)'%3E%3Crect x='0' y='0' width='10' height='18' rx='2'/%3E%3C/g%3E%3Cg transform='translate(10, 120) rotate(0)'%3E%3Cpath d='M0 5 q5 -10 10 0 t10 0' stroke-linecap='round'/%3E%3C/g%3E%3C!-- Fillers --%3E%3Ccircle cx='60' cy='60' r='1.5' fill='%23ffffff'/%3E%3Cpath d='M90 130 l4 4 m-4 0 l4 -4' stroke-width='1'/%3E%3Ccircle cx='140' cy='20' r='2' stroke='none' fill='%23ffffff'/%3E%3Cpath d='M30 5 l3 3 m-3 0 l3 -3' stroke-width='1'/%3E%3Ccircle cx='80' cy='30' r='1'/%3E%3Ccircle cx='110' cy='110' r='1.5'/%3E%3C/g%3E%3C/svg%3E")`,
          backgroundSize: '140px 140px',
        }}
      />

      <div className="max-w-[1400px] mx-auto px-6 lg:px-12 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
          {/* Column 1: Brand Info (Compact) */}
          <div className="space-y-4">
            <Link
              href={asRoute(storeSlug || '')}
              className="flex items-center cursor-pointer select-none"
            >
              <Logo className="h-10 w-auto" />
            </Link>
            <p className="text-gray-400 text-xs leading-relaxed max-w-xs">
              Making Smartphones Accessible and Affordable
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <a
                href="https://instagram.com/ogabasseyy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Instagram"
              >
                <Instagram size={20} />
              </a>
              <a
                href="https://www.facebook.com/ogabasseyyy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Facebook"
              >
                <Facebook size={20} />
              </a>
              <a
                href="https://www.tiktok.com/@ogabasseyy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="TikTok"
              >
                <Music size={20} />
              </a>
              <a
                href="https://x.com/ogabasseyy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="X (formerly Twitter)"
              >
                <Twitter size={20} />
              </a>
              <a
                href="https://www.youtube.com/@ogabassey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="YouTube"
              >
                <Youtube size={20} />
              </a>
              <a
                href="https://www.linkedin.com/company/ogabasseyy/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="LinkedIn"
              >
                <Linkedin size={20} />
              </a>
            </div>
          </div>

          {/* Column 2: Quick Links (Merged) */}
          <div className="flex justify-between md:justify-start gap-12">
            <div>
              <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">
                Company
              </h3>
              <ul className="space-y-2 text-xs text-gray-400">
                <li>
                  <Link href={asRoute(getUrl('/about'))} className="hover:text-primary">
                    About Us
                  </Link>
                </li>
                <li>
                  <span className="cursor-default text-gray-500">
                    Careers
                  </span>
                </li>
                <li>
                  <Link href={asRoute(getUrl('/blog'))} className="hover:text-primary">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href={asRoute(getUrl('/privacy'))} className="hover:text-primary">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href={asRoute(getUrl('/terms'))} className="hover:text-primary">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link href={asRoute(getUrl('/about'))} className="hover:text-primary">
                    Sustainability
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">
                Services
              </h3>
              <ul className="space-y-2 text-xs text-gray-400">
                <li>
                  <Link href={asRoute(getUrl('/repairs'))} className="hover:text-primary">
                    Repairs
                  </Link>
                </li>
                <li>
                  <Link href={asRoute(getUrl('/swap'))} className="hover:text-primary">
                    Sell Device
                  </Link>
                </li>
                <li>
                  <Link href={asRoute(getUrl('/track-order'))} className="hover:text-primary">
                    Track Order
                  </Link>
                </li>
                <li>
                  <Link href={asRoute(getUrl('/faq'))} className="hover:text-primary">
                    Support
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Column 3: Contact (Compact) */}
          <div>
            <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">
              Contact
            </h3>
            <ul className="space-y-3 text-xs text-gray-400">
              <li className="flex items-start gap-2">
                <MapPin className="shrink-0 text-primary mt-0.5" size={16} />
                <span>1st Floor Taiyelolu Towers,<br />2 Olaide Tomori St, Ikeja, Lagos</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="shrink-0 text-primary" size={16} />
                <span>+234 814 697 8921</span>
              </li>
              <li className="flex items-center gap-2">
                <Mail className="shrink-0 text-primary" size={16} />
                <a
                  href="mailto:support@ogabassey.com"
                  className="hover:text-white transition-colors"
                >
                  support@ogabassey.com
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: App & Payment (Horizontal) */}
          <div>
            <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">
              Download App
            </h3>
            <div className="flex gap-2 mb-6">
              <button type="button"
                className="flex items-center gap-2 bg-black border border-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-900 transition-colors group"
                aria-label="Download on the App Store"
              >
                <Apple size={22} className="text-white fill-current" aria-hidden="true" />
                <div className="text-left leading-none">
                  <div className="text-[9px] text-gray-400 font-medium group-hover:text-gray-300">
                    Download on the
                  </div>
                  <div className="text-[13px] font-bold text-white tracking-wide">
                    App Store
                  </div>
                </div>
              </button>
              <button type="button"
                className="flex items-center gap-2 bg-black border border-gray-700 rounded-lg px-3 py-1.5 hover:bg-gray-900 transition-colors group"
                aria-label="Get it on Google Play"
              >
                <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.64 12.48l-2.95-3.07L16.2 13.9l4.49 4.49c.87-.93 1.35-2.22.95-3.55zM.65 1.57C.24 2.21 0 3.06 0 4.13v15.74c0 1.07.24 1.92.65 2.56l.06.05L13.1 10.09v-.19L.71 1.52l-.06.05z"
                  />
                  <path
                    fill="#34A853"
                    d="M14.39 12.1L2.09 24.4c.39.11.83.07 1.19-.13l16.29-9.28-5.18-5.18v2.29z"
                  />
                  <path
                    fill="#EA4335"
                    d="M2.09-.4c-.36-.2-.8-.24-1.19-.13L14.39 11.9l5.18-5.18L3.28-.53c-.39-.2-.79-.2-1.19.13z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M.65 1.57C.24 2.21 0 3.06 0 4.13v15.74c0 1.07.24 1.92.65 2.56l.06.05L13.1 10.09v-.19L.71 1.52l-.06.05z"
                  />
                </svg>
                <div className="text-left leading-none">
                  <div className="text-[9px] text-gray-400 font-medium group-hover:text-gray-300 uppercase">
                    Get it on
                  </div>
                  <div className="text-[13px] font-bold text-white tracking-wide">
                    Google Play
                  </div>
                </div>
              </button>
            </div>

            <div className="flex items-center gap-3 opacity-70 grayscale hover:grayscale-0 transition-all">
              <span className="text-xs font-bold text-white">Secured by:</span>
              <div className="h-4 w-auto bg-white/20 rounded px-1 flex items-center justify-center text-[8px] font-bold text-white tracking-tighter px-2">
                PAYSTACK
              </div>
              <div className="h-4 w-auto bg-white/20 rounded px-1 flex items-center justify-center text-[8px] font-bold text-white tracking-tighter px-2">
                FLUTTERWAVE
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-gray-800 text-center text-[10px] text-gray-500">
          <span>&copy; Ogabassey Ltd. All rights reserved.</span>
        </div>
      </div>
    </footer>
  );
};
