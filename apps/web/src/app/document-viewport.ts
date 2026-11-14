import type { Viewport } from 'next';

export const documentViewport: Viewport = {
  // Core viewport settings for responsive design
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5, // Allow zoom for accessibility (WCAG 1.4.4)
  userScalable: true, // Never disable zoom - accessibility requirement
  // Enable safe area support for notched devices (iPhone, etc.)
  viewportFit: 'cover',
  // Theme color for browser chrome (neutral for dashboard/platform)
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0F0F0F' },
  ],
  // Color scheme support
  colorScheme: 'light dark',
};
