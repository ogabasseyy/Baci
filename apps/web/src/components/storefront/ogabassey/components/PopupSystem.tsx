'use client';

import { ArrowRight, Mail, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { AdUnit } from './AdUnit';
import { useDeferredActivation } from './deferred-shell-feature';

export const PopupSystem: React.FC = () => {
  const [showNewsletter, setShowNewsletter] = useState(false);
  const [showAdPopup, setShowAdPopup] = useState(false);
  const adTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasEngaged = useDeferredActivation({
    timeoutMs: 0,
    activateOnIdle: false,
  });

  // Logic:
  // 1. Show Newsletter after 4 seconds (only if not dismissed in last 7 days)
  // 2. When newsletter is closed, start timer for Ad (5 mins requested, set to 10s for demo)

  const NEWSLETTER_STORAGE_KEY = 'ogabassey-newsletter-dismissed';
  const NEWSLETTER_EXPIRY_DAYS = 7; // Re-show after 7 days

  useEffect(() => {
    if (!hasEngaged) {
      return;
    }

    // Check if already dismissed within expiry period
    try {
      const dismissedAt = localStorage.getItem(NEWSLETTER_STORAGE_KEY);
      if (dismissedAt) {
        const dismissedDate = new Date(dismissedAt);
        const now = new Date();
        const daysSinceDismissed = (now.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceDismissed < NEWSLETTER_EXPIRY_DAYS) {
          // Don't show - dismissed recently
          return;
        }
      }
    } catch {
      // localStorage not available, proceed with showing
    }

    // Initial delay for newsletter
    const timer = setTimeout(() => {
      setShowNewsletter(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, [hasEngaged]);

  // Cleanup ad timer on unmount
  useEffect(() => {
    return () => {
      if (adTimerRef.current) {
        clearTimeout(adTimerRef.current);
      }
    };
  }, []);

  const handleCloseNewsletter = () => {
    setShowNewsletter(false);

    // Save dismissal to localStorage
    try {
      localStorage.setItem(NEWSLETTER_STORAGE_KEY, new Date().toISOString());
    } catch {
      // Ignore if localStorage unavailable
    }

    // Start timer for Ad Popup
    // NOTE: For demonstration, this is set to 10 seconds (10000ms).
    // To change to 5 minutes, update to: 300000
    adTimerRef.current = setTimeout(() => {
      setShowAdPopup(true);
    }, 10000);
  };

  return (
    <>
      {/* --- 1. NEWSLETTER POPUP (Centered Overlay) --- */}
      {showNewsletter && (
        <div className="fixed inset-0 z-70 flex items-center justify-center px-4 animate-in fade-in duration-300">
          <button
            type="button"
            aria-label="Dismiss newsletter popup backdrop"
            tabIndex={-1}
            className="absolute inset-0 border-0 bg-black/60 p-0 backdrop-blur-xs"
            onClick={handleCloseNewsletter}
          />
          <div className="bg-[#1a1a1a] rounded-2xl shadow-2xl max-w-md w-full relative overflow-hidden z-10 animate-in zoom-in-95 duration-300 border border-white/10">
            {/* Decorative Header */}
            <div className="h-32 bg-[#1a1a1a] relative flex items-center justify-center overflow-hidden">
              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                }}
              />
              <div className="relative z-10 size-16 bg-white rounded-full flex items-center justify-center shadow-lg">
                <Mail size={32} className="text-red-600" />
              </div>
              <button
                type="button"
                onClick={handleCloseNewsletter}
                className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
                aria-label="Close newsletter"
              >
                <X size={24} />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 text-center pt-2">
              <h3 className="text-2xl font-bold text-white mb-2">
                Join Ogabassey
              </h3>
              <p className="text-gray-400 mb-6 text-sm">
                Subscribe to our newsletter and get exclusive access to flash
                sales, new arrivals, and tech tips.
              </p>

              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCloseNewsletter();
                }}
              >
                <input
                  type="email"
                  id="newsletter-email"
                  name="email"
                  autoComplete="email"
                  aria-label="Email address"
                  placeholder="Enter your email address"
                  className="w-full px-4 py-3 bg-transparent border border-white/20 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-red-600/20 focus:border-red-600 transition-all text-white placeholder:text-white/40 text-sm"
                />
                <button
                  type="submit"
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg hover:shadow-red-200"
                >
                  Subscribe & Save
                </button>
              </form>
              <button
                type="button"
                onClick={handleCloseNewsletter}
                className="mt-4 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                No thanks, I prefer paying full price
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 2. AD POPUP (Bottom Left Slide-in) --- */}
      {showAdPopup && (
        <div className="fixed bottom-0 left-0 p-4 md:p-6 z-60 animate-in slide-in-from-left-10 duration-500 fade-in">
          <div className="bg-white rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.2)] border border-gray-100 overflow-hidden max-w-[320px] md:max-w-[350px] relative">
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setShowAdPopup(false)}
              className="absolute top-2 right-2 size-6 bg-white/80 rounded-full flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-white transition-colors z-20 shadow-sm"
              aria-label="Close ad"
            >
              <X size={14} />
            </button>

            <div className="flex flex-col">
              <div className="bg-[#1a1a1a] px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] font-bold text-white uppercase tracking-widest">
                  Sponsored
                </span>
                <span className="text-[10px] text-gray-400">Ad</span>
              </div>

              {/* Ad Content */}
              <div className="p-0">
                <AdUnit
                  placementKey="PRODUCT_SIDEBAR"
                  className="my-0 scale-90 origin-top-left"
                />
              </div>

              <div className="bg-gray-50 px-4 py-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600">
                  Special Offer
                </span>
                <button
                  type="button"
                  className="text-xs font-bold text-red-600 flex items-center gap-1 hover:gap-2 transition-all"
                >
                  View Details <ArrowRight size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
