import type { Config } from '@puckeditor/core';
import Autoplay from 'embla-carousel-autoplay';
import {
  Facebook,
  Instagram,
  Linkedin,
  Quote,
  Search as SearchIcon,
  Star,
  Twitter,
  Youtube,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import React from 'react';
import { Header as StorefrontHeader } from '@/components/storefront/blocks/header';
import {
  OgabasseyCategories,
  type OgabasseyCategoriesProps,
} from '@/components/storefront/blocks/ogabassey-categories';
import {
  OgabasseyHeader,
  type OgabasseyHeaderProps,
} from '@/components/storefront/blocks/ogabassey-header';
import {
  OgabasseyHero,
  type OgabasseyHeroProps,
} from '@/components/storefront/blocks/ogabassey-hero';
import {
  OgabasseyNav,
  type OgabasseyNavProps,
} from '@/components/storefront/blocks/ogabassey-nav';
import {
  OgabasseyUtilities,
  type OgabasseyUtilitiesProps,
} from '@/components/storefront/blocks/ogabassey-utilities';
import { StorefrontProductGrid } from '@/components/storefront/product-grid';
import { ThemedButton } from '@/components/themed/themed-button';
import { Button } from '@/components/ui/button';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { Input } from '@/components/ui/input';
import { asRoute } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { AnimatedWrapper, type AnimationType } from './animated-wrapper';
import {
  CuratedFooter,
  type CuratedFooterProps,
} from './curated-footer-component';
import {
  FeaturesComponent,
  type FeaturesComponentProps,
} from './features-component';
import { ColorPickerField } from './fields/color-picker-field';
import { ImagePickerField } from './fields/image-picker-field';
import { type HeroProps, heroComponent } from './hero-component';
import { getIconOptions, renderIcon } from './icon-registry';
import {
  NewsletterComponent,
  type NewsletterComponentProps,
} from './newsletter-component';
import { ScopedStorefrontLink } from './scoped-storefront-link';
import { useStorefrontScopedRoute } from './use-storefront-scoped-route';

// Helper to map config animation values to AnimationType
const mapAnimationType = (type: string | undefined): AnimationType => {
  const map: Record<string, AnimationType> = {
    fade: 'fade-in',
    slide: 'slide-up',
    zoom: 'zoom-in',
    none: 'none',
  };
  return map[type ?? 'none'] ?? 'none';
};

import {
  type FormField,
  StorefrontForm,
} from '@/components/storefront/storefront-form';

const VIDEO_IFRAME_SANDBOX =
  'allow-same-origin allow-scripts allow-presentation allow-popups allow-popups-to-escape-sandbox';
const MAP_IFRAME_SANDBOX =
  'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms';
const getGoogleMapsQueryEmbedUrl = (address: string, zoom = 12) =>
  `https://www.google.com/maps?q=${encodeURIComponent(address)}&t=&z=${zoom}&ie=UTF8&iwloc=&output=embed`;

// ==================== TYPE DEFINITIONS ====================

// Common animation fields that can be added to any component
const animationFields = {
  animationType: {
    type: 'select' as const,
    label: 'Animation',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Fade In', value: 'fade-in' },
      { label: 'Slide Up', value: 'slide-up' },
      { label: 'Slide Down', value: 'slide-down' },
      { label: 'Slide Left', value: 'slide-left' },
      { label: 'Slide Right', value: 'slide-right' },
      { label: 'Zoom In', value: 'zoom-in' },
      { label: 'Scale Up', value: 'scale-up' },
    ],
  },
  animationDuration: {
    type: 'select' as const,
    label: 'Animation Speed',
    options: [
      { label: 'Fast', value: 'fast' },
      { label: 'Normal', value: 'normal' },
      { label: 'Slow', value: 'slow' },
    ],
  },
  animationDelay: {
    type: 'number' as const,
    label: 'Animation Delay (seconds)',
    min: 0,
    max: 5,
    step: 0.1,
  },
  animationTrigger: {
    type: 'select' as const,
    label: 'Animation Trigger',
    options: [
      { label: 'On Page Load', value: 'immediate' },
      { label: 'On Scroll Into View', value: 'scroll' },
    ],
  },
};

type HeroCarouselProps = {
  slides: {
    image: string;
    title: string;
    subtitle: string;
    ctaText: string;
    ctaLink: string;
  }[];
  autoplayDelay?: number;
};

type TextProps = {
  title?: string;
  content: string;
  align: 'left' | 'center' | 'right';
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type ImageProps = {
  src: string;
  alt: string;
  aspectRatio: 'auto' | '16/9' | '4/3' | '1/1';
  link?: string;
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type ButtonProps = {
  text: string;
  link: string;
  variant: 'primary' | 'background' | 'accent';
  align: 'left' | 'center' | 'right';
  size: 'sm' | 'default' | 'lg';
};

type ProductGridProps = {
  title: string;
  columns: number;
  limit: number;
  category?: string;
  sortBy?: 'newest' | 'price-low' | 'price-high' | 'name';
  showFilters?: boolean;
};

type TestimonialProps = {
  quote: string;
  author: string;
  role: string;
  rating?: number;
  avatar?: string;
};

type SpacerProps = {
  height: 'small' | 'medium' | 'large' | 'xlarge';
};

type HeaderProps = {
  showLogo: boolean;
  showSearch: boolean;
  showCart: boolean;
  showMenu: boolean;
  showAccount?: boolean;
  navigationLinks: { label: string; url: string }[];
  ctaButton?: {
    text: string;
    url: string;
    show: boolean;
  };
  backgroundColor?: string;
  textColor?: string;
  sticky?: boolean;
  logoUrl?: string;
  storeName?: string;
  layout?: 'logo-left-nav-center' | 'logo-left-nav-right' | 'logo-center';
  searchStyle?: 'outline' | 'filled' | 'minimal';
  searchRadius?: 'none' | 'sm' | 'md' | 'full';
  paddingY?: 'sm' | 'md' | 'lg';
  glassEffect?: boolean;
  backgroundImage?: string;
};

type VideoProps = {
  url: string;
  title?: string;
  autoplay?: boolean;
  controls?: boolean;
};

type MapProps = {
  address: string;
  zoom: number;
  height?: string;
};

type InstagramFeedProps = {
  username: string;
  postsCount?: number;
};

type ContactFormProps = {
  formName: string;
  fields: FormField[];
  submitButtonText?: string;
  successMessage?: string;
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type SocialIconsProps = {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  youtube?: string;
  size?: 'sm' | 'md' | 'lg';
  alignment?: 'left' | 'center' | 'right';
};

type CodeEmbedProps = {
  code: string;
  language?: string;
};

type SearchProps = {
  placeholder: string;
  showFilters?: boolean;
};

type FAQProps = {
  title: string;
  subtitle?: string;
  items: { question: string; answer: string }[];
  style: 'accordion' | 'grid' | 'list';
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type AboutSectionProps = {
  title: string;
  content: string;
  image?: string;
  imagePosition: 'left' | 'right' | 'top' | 'bottom';
  showStats?: boolean;
  stats?: { value: string; label: string }[];
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type ContactSectionProps = {
  title: string;
  subtitle?: string;
  showMap?: boolean;
  mapAddress?: string;
  contactInfo?: { icon: string; label: string; value: string; link?: string }[];
  showForm?: boolean;
  formTitle?: string;
  layout: 'side-by-side' | 'stacked';
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type LegalSectionProps = {
  title: string;
  lastUpdated?: string;
  sections?: { heading: string; content: string }[];
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type CountdownTimerProps = {
  endDate: string;
  title?: string;
  subtitle?: string;
  expiredMessage?: string;
  style: 'boxes' | 'inline' | 'minimal';
  showDays?: boolean;
  showHours?: boolean;
  showMinutes?: boolean;
  showSeconds?: boolean;
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type TrustBadgesProps = {
  badges: { icon: string; title: string; description?: string }[];
  layout: 'horizontal' | 'grid';
  style: 'cards' | 'minimal' | 'icons-only';
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type AnnouncementBarProps = {
  message: string;
  linkText?: string;
  linkUrl?: string;
  backgroundColor?: string;
  textColor?: string;
  dismissible?: boolean;
  animationType?: string;
  animationDuration?: string;
  animationDelay?: number;
  animationTrigger?: string;
};

type RootProps = {
  title: string;
};

// ==================== HELPER COMPONENTS ====================
// Storefront-scoping helpers (utility + hook + link wrapper) live in
// dedicated modules to keep this config file focused.
// See: storefront-scoping.ts, use-storefront-scoped-route.ts,
//      scoped-storefront-link.tsx

function HeroCarouselComponent({
  slides,
  autoplayDelay = 5000,
}: HeroCarouselProps) {
  const plugin = Autoplay({ delay: autoplayDelay, stopOnInteraction: true });
  // Ensure slides is always an array to prevent "slides.map is not a function" error
  const safeSlides = Array.isArray(slides) ? slides : [];
  const toScopedRoute = useStorefrontScopedRoute();

  return (
    <section className="w-full relative" aria-label="Hero Carousel">
      <Carousel className="w-full" plugins={[plugin]} opts={{ loop: true }}>
        <CarouselContent>
          {safeSlides.map((slide, index) => (
            <CarouselItem
              // biome-ignore lint/suspicious/noArrayIndexKey: index is combined with a content fingerprint to disambiguate duplicate / placeholder slides whose content alone would collide.
              key={`slide-${index}-${[
                slide.image,
                slide.title ?? '',
                slide.subtitle ?? '',
                slide.ctaText ?? '',
                slide.ctaLink ?? '',
              ].join('|')}`}
            >
              <div className="w-full h-[60vh] md:h-[70vh] relative">
                <Image
                  src={slide.image}
                  alt={slide.title}
                  fill
                  sizes="100vw"
                  className="object-cover"
                  priority={index === 0}
                />
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-center text-white p-4">
                  <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-4">
                    {slide.title}
                  </h2>
                  <p className="text-lg md:text-xl max-w-2xl mb-8">
                    {slide.subtitle}
                  </p>
                  <ThemedButton asChild size="lg" colorRole="accent">
                    <Link href={toScopedRoute(slide.ctaLink)}>
                      {slide.ctaText}
                    </Link>
                  </ThemedButton>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 hidden md:flex"
          aria-label="Previous Slide"
        />
        <CarouselNext
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 hidden md:flex"
          aria-label="Next Slide"
        />
      </Carousel>
    </section>
  );
}

// ==================== PUCK CONFIGURATION ====================

export const builderConfig: Config<
  {
    OgabasseyHeader: OgabasseyHeaderProps;
    OgabasseyHero: OgabasseyHeroProps;
    OgabasseyNav: OgabasseyNavProps;
    OgabasseyCategories: OgabasseyCategoriesProps;
    OgabasseyUtilities: OgabasseyUtilitiesProps;
    Header: HeaderProps;
    Hero: HeroProps;
    HeroCarousel: HeroCarouselProps;
    Text: TextProps;
    Image: ImageProps;
    Button: ButtonProps;
    ProductGrid: ProductGridProps;
    Testimonial: TestimonialProps;
    Features: FeaturesComponentProps;
    Newsletter: NewsletterComponentProps;
    Spacer: SpacerProps;
    Footer: CuratedFooterProps;
    Video: VideoProps;
    Map: MapProps;
    InstagramFeed: InstagramFeedProps;
    ContactForm: ContactFormProps;
    SocialIcons: SocialIconsProps;
    CodeEmbed: CodeEmbedProps;
    Search: SearchProps;
    FAQ: FAQProps;
    AboutSection: AboutSectionProps;
    ContactSection: ContactSectionProps;
    LegalSection: LegalSectionProps;
    CountdownTimer: CountdownTimerProps;
    TrustBadges: TrustBadgesProps;
    AnnouncementBar: AnnouncementBarProps;
  },
  RootProps
> = {
  categories: {
    layout: {
      title: 'Layout',
      components: [
        'Header',
        'Hero',
        'HeroCarousel',
        'Text',
        'Spacer',
        'Features',
        'Footer',
        'AnnouncementBar',
      ],
    },
    content: {
      title: 'Content',
      components: ['AboutSection', 'FAQ', 'LegalSection', 'ContactSection'],
    },
    media: {
      title: 'Media',
      components: ['Image', 'Video', 'Testimonial', 'InstagramFeed', 'Map'],
    },
    commerce: {
      title: 'Commerce',
      components: [
        'ProductGrid',
        'Button',
        'Newsletter',
        'ContactForm',
        'Search',
        'CountdownTimer',
        'TrustBadges',
      ],
    },
    advanced: {
      title: 'Advanced',
      components: ['SocialIcons', 'CodeEmbed'],
    },
  },
  root: {
    fields: {
      title: { type: 'text', label: 'Page Title' },
    },
    render: ({ children }) => {
      return <>{children}</>;
    },
  },
  components: {
    Header: {
      label: 'Header Navigation',
      permissions: { delete: false, duplicate: false },
      fields: {
        showLogo: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showSearch: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showCart: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showMenu: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        sticky: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        navigationLinks: {
          type: 'array',
          getItemSummary: (item) => item.label || 'Link',
          arrayFields: {
            label: { type: 'text' },
            url: { type: 'text' },
          },
        },
        ctaButton: {
          type: 'object',
          objectFields: {
            show: {
              type: 'radio',
              options: [
                { label: 'Yes', value: true },
                { label: 'No', value: false },
              ],
            },
            text: { type: 'text' },
            url: { type: 'text' },
          },
        },
        backgroundColor: {
          type: 'custom',
          label: 'Background Color',
          render: ({ value, onChange }) => (
            <ColorPickerField value={value || ''} onChange={onChange} />
          ),
        },
        textColor: {
          type: 'custom',
          label: 'Text Color',
          render: ({ value, onChange }) => (
            <ColorPickerField value={value || ''} onChange={onChange} />
          ),
        },

        // New Customization Fields
        layout: {
          type: 'select',
          label: 'Layout Style',
          options: [
            { label: 'Logo Left, Nav Center', value: 'logo-left-nav-center' },
            { label: 'Logo Left, Nav Right', value: 'logo-left-nav-right' },
            { label: 'Logo Center', value: 'logo-center' },
          ],
        },
        searchStyle: {
          type: 'radio',
          label: 'Search Bar Style',
          options: [
            { label: 'Outline', value: 'outline' },
            { label: 'Filled', value: 'filled' },
            { label: 'Minimal', value: 'minimal' },
          ],
        },
        searchRadius: {
          type: 'radio',
          label: 'Search Corner Radius',
          options: [
            { label: 'Square', value: 'none' },
            { label: 'Small', value: 'sm' },
            { label: 'Medium', value: 'md' },
            { label: 'Round', value: 'full' },
          ],
        },
        paddingY: {
          type: 'select',
          label: 'Vertical Padding',
          options: [
            { label: 'Compact', value: 'sm' },
            { label: 'Standard', value: 'md' },
            { label: 'Spacious', value: 'lg' },
          ],
        },
        glassEffect: {
          type: 'radio',
          label: 'Glassmorphism Effect',
          options: [
            { label: 'Enabled', value: true },
            { label: 'Disabled', value: false },
          ],
        },
      },
      defaultProps: {
        showLogo: true,
        showSearch: true,
        showCart: true,
        showMenu: true,
        sticky: true,
        navigationLinks: [
          { label: 'Home', url: '/' },
          { label: 'Shop', url: '/products' },
          { label: 'About', url: '/about' },
        ],
        ctaButton: {
          show: false,
          text: 'Get Started',
          url: '/signup',
        },
        layout: 'logo-left-nav-center',
        searchStyle: 'outline',
        searchRadius: 'md',
        paddingY: 'md',
        glassEffect: false,
      },
      render: (props) => <StorefrontHeader {...props} />,
    },
    Hero: heroComponent,
    OgabasseyHeader: {
      label: 'Ogabassey Header',
      permissions: { delete: true, duplicate: true },
      fields: {
        logoText: { type: 'text', label: 'Logo Text' },
        showSearch: {
          type: 'radio',
          label: 'Show Search',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showCart: {
          type: 'radio',
          label: 'Show Cart',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showUser: {
          type: 'radio',
          label: 'Show User',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showBell: {
          type: 'radio',
          label: 'Show Bell',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
      },
      defaultProps: {
        logoText: 'ogabassey',
        showSearch: true,
        showCart: true,
        showUser: true,
        showBell: true,
      },
      render: (props) => <OgabasseyHeader {...props} />,
    },
    OgabasseyHero: {
      label: 'Ogabassey Hero',
      permissions: { delete: true, duplicate: true },
      fields: {
        slides: {
          type: 'array',
          getItemSummary: (item) => item.title || 'Slide',
          arrayFields: {
            image: { type: 'text', label: 'Image URL' },
            title: { type: 'text', label: 'Title' },
            link: { type: 'text', label: 'Link URL' },
          },
        },
        staticBanner1: { type: 'text', label: 'Static Banner 1 URL' },
        staticBanner2: { type: 'text', label: 'Static Banner 2 URL' },
        autoplayDelay: { type: 'number', label: 'Autoplay Delay (ms)' },
      },
      defaultProps: {
        slides: [
          {
            image: '/placeholder.png',
            title: 'iPhone 15 Pro Max',
            link: '/category/phones',
          },
          {
            image: '/placeholder.png',
            title: 'PlayStation 5',
            link: '/category/gaming',
          },
        ],
        staticBanner1: '/placeholder.png',
        staticBanner2: '/placeholder.png',
        autoplayDelay: 5000,
      },
      render: (props) => <OgabasseyHero {...props} />,
    },
    OgabasseyNav: {
      label: 'Ogabassey Nav',
      permissions: { delete: true, duplicate: true },
      fields: {
        links: {
          type: 'array',
          getItemSummary: (item) => item.label || 'Link',
          arrayFields: {
            label: { type: 'text', label: 'Label' },
            url: { type: 'text', label: 'URL' },
          },
        },
        activeColor: { type: 'text', label: 'Active Color (Hex)' },
      },
      defaultProps: {
        links: [
          { label: 'Home', url: '/' },
          { label: 'Smart phones', url: '/category/smart-phones' },
          { label: 'Laptops', url: '/category/laptops' },
          { label: 'Accessories', url: '/category/accessories' },
          { label: 'Gaming', url: '/category/gaming' },
        ],
        activeColor: '#D62027',
      },
      render: (props) => <OgabasseyNav {...props} />,
    },
    OgabasseyCategories: {
      label: 'Ogabassey Categories',
      permissions: { delete: true, duplicate: true },
      fields: {
        categories: {
          type: 'array',
          getItemSummary: (item) => item.label || 'Category',
          arrayFields: {
            label: { type: 'text', label: 'Label' },
            icon: {
              type: 'select',
              label: 'Icon',
              options: getIconOptions(),
            },
            link: { type: 'text', label: 'Link URL' },
          },
        },
        backgroundColor: {
          type: 'custom',
          label: 'Background Color (Hex)',
          render: ({ value, onChange }) => (
            <ColorPickerField value={value || ''} onChange={onChange} />
          ),
        },
        iconColor: {
          type: 'custom',
          label: 'Icon Color (Hex)',
          render: ({ value, onChange }) => (
            <ColorPickerField value={value || ''} onChange={onChange} />
          ),
        },
      },
      defaultProps: {
        categories: [
          { label: 'Phones', icon: 'smartphone', link: '/category/phones' },
          { label: 'Gaming', icon: 'gamepad', link: '/category/gaming' },
          {
            label: 'Accessories',
            icon: 'headphones',
            link: '/category/accessories',
          },
          { label: 'Printers', icon: 'printer', link: '/category/printers' },
          { label: 'Laptop', icon: 'laptop', link: '/category/laptops' },
        ],
        backgroundColor: '#FEF2F2',
        iconColor: '#DC2626',
      },
      render: (props) => <OgabasseyCategories {...props} />,
    },
    OgabasseyUtilities: {
      label: 'Ogabassey Utilities',
      permissions: { delete: true, duplicate: true },
      fields: {
        services: {
          type: 'array',
          getItemSummary: (item) => item.label || 'Service',
          arrayFields: {
            label: { type: 'text', label: 'Label' },
            icon: {
              type: 'select',
              label: 'Icon',
              options: getIconOptions(),
            },
          },
        },
        startText: { type: 'text', label: 'Start Text' },
        highlightText: { type: 'text', label: 'Highlight Text' },
        middleText: { type: 'text', label: 'Middle Text' },
        endText: { type: 'text', label: 'End Text' },
        endHighlightText: { type: 'text', label: 'End Highlight Text' },
      },
      defaultProps: {
        services: [
          { label: 'Phones', icon: 'smartphone' },
          { label: 'Gaming', icon: 'gamepad' },
          { label: 'Accessories', icon: 'headphones' },
          { label: 'Printers', icon: 'printer' },
          { label: 'Laptop', icon: 'laptop' },
        ],
        startText: 'We Pay',
        highlightText: 'YOU',
        middleText: 'When',
        endText: 'You Buy',
        endHighlightText: 'Airtime!',
      },
      render: (props) => <OgabasseyUtilities {...props} />,
    },
    HeroCarousel: {
      label: 'Hero Carousel',
      permissions: { delete: true, duplicate: false },
      fields: {
        autoplayDelay: {
          type: 'number',
          label: 'Autoplay Delay (ms)',
          min: 1000,
          max: 10000,
        },
        slides: {
          type: 'array',
          getItemSummary: (item) => item.title || 'Slide',
          arrayFields: {
            image: { type: 'text', label: 'Image URL' },
            title: { type: 'text' },
            subtitle: { type: 'textarea' },
            ctaText: { type: 'text' },
            ctaLink: { type: 'text' },
          },
        },
      },
      defaultProps: {
        autoplayDelay: 5000,
        slides: [
          {
            image: '/placeholder.png',
            title: 'Welcome to Your Store',
            subtitle:
              'Customize this slide with your own images and text to showcase your products.',
            ctaText: 'Shop Now',
            ctaLink: '#products',
          },
          {
            image: '/placeholder.png',
            title: 'Featured Collection',
            subtitle:
              'Add your seasonal promotions or highlight bestselling products here.',
            ctaText: 'View Collection',
            ctaLink: '#products',
          },
        ],
      },
      render: ({ slides, autoplayDelay }) => (
        <HeroCarouselComponent slides={slides} autoplayDelay={autoplayDelay} />
      ),
    },
    Text: {
      label: 'Text Block',
      permissions: { delete: true, duplicate: true },
      fields: {
        // biome-ignore lint/suspicious/noExplicitAny: Puck field types don't include inline/contentEditable
        title: { type: 'text', inline: true, contentEditable: true } as any,
        content: {
          type: 'textarea',
          inline: true,
          contentEditable: true,
          // biome-ignore lint/suspicious/noExplicitAny: Puck field types don't include inline/contentEditable
        } as any,
        align: {
          type: 'select',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
        ...animationFields,
      },
      defaultProps: {
        title: 'About Us',
        content: 'Write something about your brand here.',
        align: 'left',
        animationType: 'fade-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: ({
        title,
        content,
        align,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) => (
        <AnimatedWrapper
          animation={{
            type: mapAnimationType(animationType),
            duration: animationDuration as 'fast' | 'normal' | 'slow',
            delay: animationDelay,
            trigger:
              animationTrigger === 'onload'
                ? 'immediate'
                : (animationTrigger as 'scroll' | 'immediate'),
          }}
        >
          <section className="py-12 container px-4 md:px-6">
            <div
              className={cn('max-w-3xl mx-auto', {
                'text-left': align === 'left',
                'text-center': align === 'center',
                'text-right': align === 'right',
              })}
            >
              {title && <h2 className="text-3xl font-bold mb-4">{title}</h2>}
              <div className="prose dark:prose-invert max-w-none">
                <p className="text-lg whitespace-pre-wrap">{content}</p>
              </div>
            </div>
          </section>
        </AnimatedWrapper>
      ),
    },
    Image: {
      label: 'Image',
      permissions: { delete: true, duplicate: true },
      fields: {
        src: {
          type: 'custom',
          label: 'Image',
          render: ({
            field,
            onChange,
            value,
          }: {
            field: { label?: string };
            onChange: (value: string) => void;
            value: string;
          }) => {
            return (
              <ImagePickerField
                field={field}
                onChange={onChange}
                value={value}
              />
            );
          },
        },
        alt: { type: 'text', label: 'Alt Text' },
        link: { type: 'text', label: 'Link URL (optional)' },
        aspectRatio: {
          type: 'select',
          options: [
            { label: 'Auto', value: 'auto' },
            { label: '16:9', value: '16/9' },
            { label: '4:3', value: '4/3' },
            { label: '1:1', value: '1/1' },
          ],
        },
        ...animationFields,
      },
      defaultProps: {
        src: '/placeholder.png',
        alt: 'Product image',
        aspectRatio: '16/9',
        animationType: 'zoom-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: ({
        src,
        alt,
        aspectRatio,
        link,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) => {
        const imageElement = (
          <div
            className="relative w-full overflow-hidden rounded-lg bg-muted"
            style={{
              aspectRatio: aspectRatio === 'auto' ? undefined : aspectRatio,
            }}
          >
            {/* ⚡ Bolt: Added sizes prop to prevent Next.js from defaulting to 100vw on fill images, reducing LCP */}
            <Image
              src={src}
              alt={alt}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover"
            />
          </div>
        );

        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <section className="py-8 container px-4 md:px-6">
              {link ? (
                <ScopedStorefrontLink
                  className="block hover:opacity-90 transition-opacity"
                  href={link}
                >
                  {imageElement}
                </ScopedStorefrontLink>
              ) : (
                imageElement
              )}
            </section>
          </AnimatedWrapper>
        );
      },
    },
    Button: {
      label: 'Button',
      permissions: { delete: true, duplicate: true },
      inline: true,
      fields: {
        text: { type: 'text' },
        link: { type: 'text' },
        size: {
          type: 'select',
          options: [
            { label: 'Small', value: 'sm' },
            { label: 'Default', value: 'default' },
            { label: 'Large', value: 'lg' },
          ],
        },
        variant: {
          type: 'select',
          options: [
            { label: 'Primary', value: 'primary' },
            { label: 'Background', value: 'background' },
            { label: 'Accent', value: 'accent' },
          ],
        },
        align: {
          type: 'select',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
      },
      defaultProps: {
        text: 'Click Me',
        link: '#',
        variant: 'primary',
        align: 'center',
        size: 'default',
      },
      render: ({ text, link, variant, align, size, puck }) => {
        return (
          <div
            ref={puck.dragRef}
            className={cn('py-4 container px-4 md:px-6 flex', {
              'justify-start': align === 'left',
              'justify-center': align === 'center',
              'justify-end': align === 'right',
            })}
          >
            <ThemedButton colorRole={variant} size={size} asChild>
              <ScopedStorefrontLink href={link}>{text}</ScopedStorefrontLink>
            </ThemedButton>
          </div>
        );
      },
    },
    ProductGrid: {
      label: 'Product Grid',
      permissions: { delete: true, duplicate: true },
      fields: {
        title: { type: 'text' },
        columns: { type: 'number', min: 2, max: 4 },
        limit: { type: 'number', min: 1, max: 24 },
        category: { type: 'text', label: 'Filter by Category (optional)' },
        sortBy: {
          type: 'select',
          label: 'Sort By',
          options: [
            { label: 'Newest', value: 'newest' },
            { label: 'Price: Low to High', value: 'price-low' },
            { label: 'Price: High to Low', value: 'price-high' },
            { label: 'Name', value: 'name' },
          ],
        },
        showFilters: {
          type: 'radio',
          label: 'Show Filter Dropdown',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
      },
      defaultProps: {
        title: 'Featured Products',
        columns: 3,
        limit: 6,
        sortBy: 'newest',
        showFilters: true,
      },
      // Removed resolveData to avoid type issues
      render: (props) => <StorefrontProductGrid {...props} />,
    },
    Footer: {
      label: 'Footer',
      permissions: { delete: false, duplicate: false },
      fields: {
        brandName: { type: 'text', label: 'Brand Name' },
        copyrightText: { type: 'text', label: 'Copyright Text' },
        quickLinksLabel: { type: 'text', label: 'Quick Links Label' },
        socialLinksLabel: { type: 'text', label: 'Social Links Label' },
        showQuickLinks: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        quickLinks: {
          type: 'array',
          getItemSummary: (item) => item.label || 'Link',
          arrayFields: {
            label: { type: 'text' },
            url: { type: 'text' },
          },
        },
        socialLinks: {
          type: 'object',
          objectFields: {
            facebook: { type: 'text', label: 'Facebook URL' },
            instagram: { type: 'text', label: 'Instagram URL' },
            twitter: { type: 'text', label: 'Twitter URL' },
            linkedin: { type: 'text', label: 'LinkedIn URL' },
            youtube: { type: 'text', label: 'YouTube URL' },
          },
        },
        showNewsletter: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        backgroundColor: {
          type: 'custom',
          label: 'Background Color',
          render: ({ value, onChange }) => (
            <ColorPickerField value={value || ''} onChange={onChange} />
          ),
        },
        textColor: {
          type: 'custom',
          label: 'Text Color',
          render: ({ value, onChange }) => (
            <ColorPickerField value={value || ''} onChange={onChange} />
          ),
        },
      },
      defaultProps: {
        brandName: 'Store',
        copyrightText: '© Store. All rights reserved.',
        quickLinksLabel: 'Quick Links',
        socialLinksLabel: 'Follow Us',
        showQuickLinks: true,
        quickLinks: [
          { label: 'About Us', url: '/about' },
          { label: 'Contact', url: '/contact' },
          { label: 'Privacy Policy', url: '/privacy' },
          { label: 'Terms', url: '/terms' },
        ],
        socialLinks: {},
        showNewsletter: false,
      },
      render: (props) => <CuratedFooter {...props} />,
    },
    Testimonial: {
      label: 'Testimonial',
      permissions: { delete: true, duplicate: true },
      fields: {
        quote: { type: 'textarea' },
        author: { type: 'text' },
        role: { type: 'text' },
        avatar: { type: 'text', label: 'Avatar URL (optional)' },
        rating: {
          type: 'number',
          min: 0,
          max: 5,
          label: 'Rating (0-5)',
        },
      },
      defaultProps: {
        quote: "This is the best product I've ever used. Highly recommended!",
        author: 'Jane Doe',
        role: 'Verified Customer',
        rating: 5,
      },
      render: ({ quote, author, role, avatar, rating = 5 }) => (
        <section className="py-12 container px-4 md:px-6">
          <div className="max-w-3xl mx-auto text-center">
            <Quote className="size-12 mx-auto mb-6 text-muted-foreground/20" />
            <blockquote className="text-2xl font-medium mb-6">
              "{quote}"
            </blockquote>
            <div className="flex flex-col items-center gap-3">
              {avatar && (
                <Image
                  src={avatar}
                  alt={author}
                  width={48}
                  height={48}
                  className="rounded-full"
                />
              )}
              <div>
                <div className="font-semibold">{author}</div>
                <div className="text-sm text-muted-foreground">{role}</div>
              </div>
              <div
                className="flex gap-1 text-yellow-400"
                role="img"
                aria-label={`Rating: ${rating} out of 5 stars`}
              >
                {[...Array(5)].map((_, i) => (
                  <Star
                    // biome-ignore lint/suspicious/noArrayIndexKey: Stars are static and stable
                    key={`star-${i}`}
                    className={cn('size-4', {
                      'fill-current': i < rating,
                    })}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      ),
    },
    Features: {
      label: 'Features Section',
      permissions: { delete: true, duplicate: true },
      fields: {
        title: { type: 'text' },
        subtitle: { type: 'textarea', label: 'Subtitle (optional)' },
        columns: {
          type: 'select',
          options: [
            { label: '2 Columns', value: 2 },
            { label: '3 Columns', value: 3 },
            { label: '4 Columns', value: 4 },
          ],
        },
        features: {
          type: 'array',
          getItemSummary: (item) => item.title || 'Feature',
          arrayFields: {
            title: { type: 'text' },
            description: { type: 'textarea' },
            icon: {
              type: 'select',
              label: 'Icon',
              options: getIconOptions(),
            },
          },
        },
        ...animationFields,
      },
      defaultProps: {
        title: 'Why Choose Us',
        columns: 3,
        features: [
          {
            title: 'Premium Quality',
            description: 'We use only the finest materials.',
            icon: 'award',
          },
          {
            title: 'Fast Shipping',
            description: 'Get your order in 2-3 business days.',
            icon: 'truck',
          },
          {
            title: '24/7 Support',
            description: 'We are here to help anytime.',
            icon: 'headphones',
          },
        ],
        animationType: 'slide-up',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: (props) => <FeaturesComponent {...props} />,
    },
    Newsletter: {
      label: 'Newsletter Signup',
      permissions: { delete: true, duplicate: true },
      fields: {
        title: { type: 'text' },
        description: { type: 'textarea' },
        placeholder: { type: 'text', label: 'Email Placeholder' },
        buttonText: { type: 'text' },
      },
      defaultProps: {
        title: 'Subscribe to our newsletter',
        description:
          'Get the latest updates and offers directly in your inbox.',
        placeholder: 'Enter your email',
        buttonText: 'Subscribe',
      },
      render: (props) => <NewsletterComponent {...props} />,
    },
    Spacer: {
      label: 'Spacer',
      permissions: { delete: true, duplicate: true },
      fields: {
        height: {
          type: 'select',
          options: [
            { label: 'Small (2rem)', value: 'small' },
            { label: 'Medium (4rem)', value: 'medium' },
            { label: 'Large (8rem)', value: 'large' },
            { label: 'Extra Large (12rem)', value: 'xlarge' },
          ],
        },
      },
      defaultProps: {
        height: 'medium',
      },
      render: ({ height }) => {
        const heightClass =
          {
            small: 'h-8',
            medium: 'h-16',
            large: 'h-32',
            xlarge: 'h-48',
          }[height] || 'h-16';
        return <div className={heightClass} aria-hidden="true" />;
      },
    },
    Video: {
      label: 'Video Embed',
      permissions: { delete: true, duplicate: true },
      fields: {
        url: { type: 'text', label: 'YouTube or Vimeo URL' },
        title: { type: 'text', label: 'Video Title (optional)' },
        autoplay: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        controls: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
      },
      defaultProps: {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        autoplay: false,
        controls: true,
      },
      render: ({ url, title, autoplay, controls }) => {
        // Extract video ID from YouTube/Vimeo URLs with proper hostname validation
        let embedUrl = '';

        // Helper function to safely check URL hostname
        const isValidVideoHost = (
          inputUrl: string,
          allowedHosts: string[]
        ): boolean => {
          try {
            const parsedUrl = new URL(inputUrl);
            const hostname = parsedUrl.hostname.toLowerCase();
            return allowedHosts.some(
              (host) => hostname === host || hostname.endsWith(`.${host}`)
            );
          } catch {
            return false;
          }
        };

        // Helper function to extract video ID safely
        const extractVideoId = (
          inputUrl: string,
          pattern: RegExp
        ): string | null => {
          try {
            const match = inputUrl.match(pattern);
            // Validate video ID contains only safe characters (alphanumeric, dash, underscore)
            if (match?.[1] && /^[\\w-]+$/.test(match[1])) {
              return match[1];
            }
            return null;
          } catch {
            return null;
          }
        };

        if (
          isValidVideoHost(url, ['youtube.com', 'www.youtube.com', 'youtu.be'])
        ) {
          // YouTube URL patterns:
          // - https://www.youtube.com/watch?v=VIDEO_ID
          // - https://youtu.be/VIDEO_ID
          const videoId = url.includes('youtu.be')
            ? extractVideoId(url, /youtu\.be\/([^?&/]+)/)
            : extractVideoId(url, /[?&]v=([^?&/]+)/);
          if (videoId) {
            embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay ? 1 : 0}&controls=${controls ? 1 : 0}`;
          }
        } else if (
          isValidVideoHost(url, [
            'vimeo.com',
            'www.vimeo.com',
            'player.vimeo.com',
          ])
        ) {
          // Vimeo URL pattern: https://vimeo.com/VIDEO_ID
          const videoId = extractVideoId(url, /vimeo\.com\/(\d+)/);
          if (videoId) {
            embedUrl = `https://player.vimeo.com/video/${videoId}?autoplay=${autoplay ? 1 : 0}`;
          }
        }

        return (
          <section className="py-8 container px-4 md:px-6">
            {title && (
              <h2 className="text-2xl font-bold mb-4 text-center">{title}</h2>
            )}
            <div className="aspect-video bg-muted flex items-center justify-center rounded-lg overflow-hidden">
              {embedUrl ? (
                <iframe
                  src={embedUrl}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  sandbox={VIDEO_IFRAME_SANDBOX}
                  title={title || 'Embedded video'}
                />
              ) : (
                <p className="text-muted-foreground">Invalid video URL</p>
              )}
            </div>
          </section>
        );
      },
    },
    Map: {
      label: 'Map Embed',
      permissions: { delete: true, duplicate: true },
      fields: {
        address: { type: 'text', label: 'Address or Location' },
        zoom: { type: 'number', min: 1, max: 20 },
        height: {
          type: 'select',
          options: [
            { label: 'Small', value: '300px' },
            { label: 'Medium', value: '450px' },
            { label: 'Large', value: '600px' },
          ],
        },
      },
      defaultProps: {
        address: 'New York, NY',
        zoom: 12,
        height: '450px',
      },
      render: ({ address, zoom, height }) => {
        const mapUrl = getGoogleMapsQueryEmbedUrl(address, zoom);

        return (
          <section className="py-8 container px-4 md:px-6">
            <div
              className="w-full bg-muted rounded-lg overflow-hidden border"
              style={{ height }}
            >
              <iframe
                src={mapUrl}
                className="w-full h-full"
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                sandbox={MAP_IFRAME_SANDBOX}
                title="Store location map"
              />
            </div>
          </section>
        );
      },
    },
    InstagramFeed: {
      label: 'Instagram Feed',
      permissions: { delete: true, duplicate: true },
      fields: {
        username: { type: 'text' },
        postsCount: {
          type: 'number',
          min: 1,
          max: 12,
          label: 'Number of Posts',
        },
      },
      defaultProps: {
        username: 'instagram',
        postsCount: 6,
      },
      render: ({ username, postsCount }) => (
        <section className="py-8 container px-4 md:px-6">
          <div className="p-8 bg-muted text-center rounded-lg border">
            <Instagram
              className="size-12 mx-auto mb-4 text-muted-foreground"
              aria-hidden="true"
            />
            <h3 className="text-lg font-semibold mb-2">Instagram Feed</h3>
            <p className="text-muted-foreground mb-4">
              @{username} - {postsCount} recent posts
            </p>
            <p className="text-sm text-muted-foreground">
              Connect your Instagram account to display real posts
            </p>
          </div>
        </section>
      ),
    },
    ContactForm: {
      label: 'Contact Form',
      permissions: { delete: true, duplicate: true },
      fields: {
        formName: { type: 'text', label: 'Form Name' },
        fields: {
          type: 'array',
          label: 'Form Fields',
          getItemSummary: (item: FormField) => item.label || 'Field',
          arrayFields: {
            id: { type: 'text', label: 'Field ID (unique)' },
            label: { type: 'text', label: 'Field Label' },
            type: {
              type: 'select',
              label: 'Field Type',
              options: [
                { label: 'Text', value: 'text' },
                { label: 'Email', value: 'email' },
                { label: 'Phone', value: 'phone' },
                { label: 'Text Area', value: 'textarea' },
                { label: 'Select Dropdown', value: 'select' },
                { label: 'Checkbox', value: 'checkbox' },
              ],
            },
            placeholder: { type: 'text', label: 'Placeholder (optional)' },
            required: {
              type: 'radio',
              label: 'Required?',
              options: [
                { label: 'Yes', value: true },
                { label: 'No', value: false },
              ],
            },
            options: {
              type: 'textarea',
              label: 'Options (for select, one per line)',
            },
          },
        },
        submitButtonText: { type: 'text', label: 'Submit Button Text' },
        successMessage: { type: 'textarea', label: 'Success Message' },
        ...animationFields,
      },
      defaultProps: {
        formName: 'Contact Form',
        fields: [
          {
            id: 'name',
            type: 'text',
            label: 'Name',
            placeholder: 'Your name',
            required: true,
          },
          {
            id: 'email',
            type: 'email',
            label: 'Email',
            placeholder: 'your@email.com',
            required: true,
          },
          {
            id: 'phone',
            type: 'phone',
            label: 'Phone',
            placeholder: '(123) 456-7890',
            required: false,
          },
          {
            id: 'message',
            type: 'textarea',
            label: 'Message',
            placeholder: 'How can we help?',
            required: true,
          },
        ],
        submitButtonText: 'Send Message',
        successMessage: "Thank you! We'll get back to you soon.",
        animationType: 'fade-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: ({
        formName,
        fields,
        submitButtonText,
        successMessage,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }: ContactFormProps) => {
        // Ensure each field has a unique ID and proper typing for FormField[]
        const formFields: FormField[] = fields.map(
          (field: Record<string, unknown>, index: number) => ({
            id: (field.id as string) || `field-${index}`,
            type: (field.type as FormField['type']) || 'text',
            label: (field.label as string) || '',
            placeholder: field.placeholder as string | undefined,
            required: field.required as boolean | undefined,
            // Convert options from textarea string to array
            options: field.options
              ? (field.options as string)
                  .split('\n')
                  .map((opt: string) => opt.trim())
                  .filter(Boolean)
              : undefined,
          })
        );

        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <section className="py-12 container px-4 md:px-6">
              <div className="max-w-md mx-auto p-8 border rounded-lg bg-card">
                <h3 className="text-2xl font-bold mb-6">{formName}</h3>
                <StorefrontForm
                  formName={formName}
                  fields={formFields}
                  submitButtonText={submitButtonText}
                  successMessage={successMessage}
                  merchantId={''} // Placeholder as we can\'t access puck context here easily
                />
              </div>
            </section>
          </AnimatedWrapper>
        );
      },
    },
    SocialIcons: {
      label: 'Social Icons',
      permissions: { delete: true, duplicate: true },
      inline: true,
      fields: {
        facebook: { type: 'text', label: 'Facebook URL' },
        instagram: { type: 'text', label: 'Instagram URL' },
        twitter: { type: 'text', label: 'Twitter URL' },
        linkedin: { type: 'text', label: 'LinkedIn URL' },
        youtube: { type: 'text', label: 'YouTube URL' },
        size: {
          type: 'select',
          options: [
            { label: 'Small', value: 'sm' },
            { label: 'Medium', value: 'md' },
            { label: 'Large', value: 'lg' },
          ],
        },
        alignment: {
          type: 'select',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
      },
      defaultProps: {
        size: 'md',
        alignment: 'center',
      },
      render: ({
        facebook,
        instagram,
        twitter,
        linkedin,
        youtube,
        size,
        alignment,
        puck,
      }) => {
        const sizeMap = {
          sm: 'w-6 h-6',
          md: 'w-8 h-8',
          lg: 'w-10 h-10',
        };

        const socialIcons = [
          { Icon: Facebook, url: facebook, name: 'Facebook' },
          { Icon: Instagram, url: instagram, name: 'Instagram' },
          { Icon: Twitter, url: twitter, name: 'Twitter' },
          { Icon: Linkedin, url: linkedin, name: 'LinkedIn' },
          { Icon: Youtube, url: youtube, name: 'YouTube' },
        ].filter(({ url }) => url);

        return (
          <div
            ref={puck.dragRef}
            className={cn('flex gap-4 p-4', {
              'justify-start': alignment === 'left',
              'justify-center': alignment === 'center',
              'justify-end': alignment === 'right',
            })}
          >
            {socialIcons.map(({ Icon, url, name }) => (
              <Link
                key={name}
                href={asRoute(url || '#')}
                className="text-muted-foreground hover:text-primary transition-colors"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Follow us on ${name}`}
              >
                <Icon className={sizeMap[size ?? 'md']} />
              </Link>
            ))}
          </div>
        );
      },
    },
    CodeEmbed: {
      label: 'Custom Code',
      permissions: { delete: true, duplicate: true },
      fields: {
        code: { type: 'textarea', label: 'HTML/JavaScript Code' },
        language: {
          type: 'select',
          options: [
            { label: 'HTML', value: 'html' },
            { label: 'JavaScript', value: 'javascript' },
          ],
        },
      },
      defaultProps: {
        code: '<div>Custom Code</div>',
        language: 'html',
      },
      render: ({ code, language }) => (
        <section className="py-8 container px-4 md:px-6">
          <div className="bg-muted p-4 rounded-lg overflow-x-auto">
            <pre className="text-sm">
              <code className={language ? `language-${language}` : ''}>
                {code}
              </code>
            </pre>
          </div>
        </section>
      ),
    },
    Search: {
      label: 'Search Bar',
      permissions: { delete: true, duplicate: true },
      fields: {
        placeholder: { type: 'text' },
        showFilters: {
          type: 'radio',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
      },
      defaultProps: {
        placeholder: 'Search products...',
        showFilters: false,
      },
      render: ({ placeholder, showFilters }) => (
        <section className="py-8 container px-4 md:px-6">
          <div className="max-w-2xl mx-auto">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-muted-foreground" />
              <Input className="pl-10 h-12 text-lg" placeholder={placeholder} />
            </div>
            {showFilters && (
              <div className="flex gap-2 mt-4 flex-wrap">
                <Button variant="outline" size="sm">
                  All
                </Button>
                <Button variant="outline" size="sm">
                  Category 1
                </Button>
                <Button variant="outline" size="sm">
                  Category 2
                </Button>
                <Button variant="outline" size="sm">
                  Category 3
                </Button>
              </div>
            )}
          </div>
        </section>
      ),
    },
    FAQ: {
      label: 'FAQ Section',
      permissions: { delete: true, duplicate: true },
      fields: {
        title: { type: 'text', label: 'Section Title' },
        subtitle: { type: 'textarea', label: 'Subtitle (optional)' },
        items: {
          type: 'array',
          label: 'FAQ Items',
          getItemSummary: (item) => item.question || 'Question',
          arrayFields: {
            question: { type: 'text', label: 'Question' },
            answer: { type: 'textarea', label: 'Answer' },
          },
        },
        style: {
          type: 'select',
          label: 'Style',
          options: [
            { label: 'Accordion', value: 'accordion' },
            { label: 'Grid', value: 'grid' },
            { label: 'Simple List', value: 'list' },
          ],
        },
        ...animationFields,
      },
      defaultProps: {
        title: 'Frequently Asked Questions',
        subtitle:
          'Find answers to common questions about our products and services.',
        style: 'accordion',
        items: [
          {
            question: 'What payment methods do you accept?',
            answer:
              'We accept all major credit cards, PayPal, and bank transfers. All payments are processed securely.',
          },
          {
            question: 'How long does shipping take?',
            answer:
              'Standard shipping takes 3-5 business days. Express shipping is available for 1-2 day delivery.',
          },
          {
            question: 'What is your return policy?',
            answer:
              'We offer a 30-day return policy for all unused items in original packaging. Contact us to initiate a return.',
          },
          {
            question: 'Do you ship internationally?',
            answer:
              'Yes, we ship to most countries worldwide. International shipping times vary by location.',
          },
        ],
        animationType: 'fade-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: ({
        title,
        subtitle,
        items,
        style,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) => {
        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <section className="py-12 md:py-16 container px-4 md:px-6">
              <div className="max-w-3xl mx-auto text-center mb-10">
                <h2 className="text-3xl font-bold mb-4">{title}</h2>
                {subtitle && (
                  <p className="text-muted-foreground text-lg">{subtitle}</p>
                )}
              </div>
              {style === 'accordion' && (
                <div className="max-w-2xl mx-auto space-y-3">
                  {items.map((item: { question: string; answer: string }) => (
                    <details
                      key={item.question}
                      className="group border rounded-lg"
                    >
                      <summary className="flex justify-between items-center cursor-pointer p-4 font-medium hover:bg-muted/50 transition-colors">
                        {item.question}
                        <span className="ml-2 transform group-open:rotate-180 transition-transform">
                          ▼
                        </span>
                      </summary>
                      <div className="p-4 pt-0 text-muted-foreground">
                        {item.answer}
                      </div>
                    </details>
                  ))}
                </div>
              )}
              {style === 'grid' && (
                <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                  {items.map((item: { question: string; answer: string }) => (
                    <div
                      key={item.question}
                      className="p-6 border rounded-lg bg-card"
                    >
                      <h3 className="font-semibold text-lg mb-2">
                        {item.question}
                      </h3>
                      <p className="text-muted-foreground">{item.answer}</p>
                    </div>
                  ))}
                </div>
              )}
              {style === 'list' && (
                <div className="max-w-2xl mx-auto space-y-6">
                  {items.map((item: { question: string; answer: string }) => (
                    <div
                      key={item.question}
                      className="border-b pb-6 last:border-0"
                    >
                      <h3 className="font-semibold text-lg mb-2">
                        {item.question}
                      </h3>
                      <p className="text-muted-foreground">{item.answer}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </AnimatedWrapper>
        );
      },
    },
    AboutSection: {
      label: 'About Section',
      permissions: { delete: true, duplicate: true },
      fields: {
        title: { type: 'text', label: 'Section Title' },
        content: { type: 'textarea', label: 'Main Content' },
        image: {
          type: 'custom',
          label: 'Image',
          render: ({ field, onChange, value }) => {
            return (
              <ImagePickerField
                field={field}
                onChange={(v) => onChange(v)}
                value={value || ''}
              />
            );
          },
        },
        imagePosition: {
          type: 'select',
          label: 'Image Position',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Right', value: 'right' },
            { label: 'Top', value: 'top' },
            { label: 'Bottom', value: 'bottom' },
          ],
        },
        showStats: {
          type: 'radio',
          label: 'Show Statistics',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        stats: {
          type: 'array',
          label: 'Statistics',
          getItemSummary: (item) => item.label || 'Stat',
          arrayFields: {
            value: { type: 'text', label: 'Value (e.g., 10K+)' },
            label: { type: 'text', label: 'Label' },
          },
        },
        ...animationFields,
      },
      defaultProps: {
        title: 'About Our Store',
        content:
          'We are passionate about bringing you the best products at competitive prices. Our journey began with a simple idea: make quality accessible to everyone.\n\nWith years of experience in the industry, we have built strong relationships with suppliers and manufacturers to ensure that every product meets our high standards.',
        image: '/placeholder.png',
        imagePosition: 'right',
        showStats: true,
        stats: [
          { value: '10K+', label: 'Happy Customers' },
          { value: '500+', label: 'Products' },
          { value: '5', label: 'Years Experience' },
          { value: '24/7', label: 'Support' },
        ],
        animationType: 'fade-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: ({
        title,
        content,
        image,
        imagePosition,
        showStats,
        stats,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) => {
        const isHorizontal =
          imagePosition === 'left' || imagePosition === 'right';
        const imageFirst = imagePosition === 'left' || imagePosition === 'top';

        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <section className="py-12 md:py-16 container px-4 md:px-6">
              <div
                className={cn(
                  'flex gap-8 md:gap-12',
                  isHorizontal
                    ? 'flex-col md:flex-row items-center'
                    : 'flex-col',
                  imageFirst && isHorizontal && 'md:flex-row-reverse'
                )}
              >
                {/* Content */}
                <div
                  className={cn('flex-1', isHorizontal ? '' : 'text-center')}
                >
                  <h2 className="text-3xl font-bold mb-6">{title}</h2>
                  <div className="prose dark:prose-invert max-w-none">
                    <p className="text-lg text-muted-foreground whitespace-pre-wrap">
                      {content}
                    </p>
                  </div>
                  {showStats && stats && stats.length > 0 && (
                    <div
                      className={cn(
                        'grid grid-cols-2 md:grid-cols-4 gap-6 mt-8',
                        !isHorizontal && 'max-w-2xl mx-auto'
                      )}
                    >
                      {stats.map((stat: { value: string; label: string }) => (
                        <div key={stat.label} className="text-center">
                          <p
                            className="text-3xl font-bold"
                            style={{ color: 'var(--store-primary)' }}
                          >
                            {stat.value}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {stat.label}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Image */}
                {image && (
                  <div
                    className={cn(
                      'flex-1',
                      !isHorizontal && 'max-w-2xl mx-auto w-full',
                      imageFirst && !isHorizontal && 'order-first'
                    )}
                  >
                    <div className="relative aspect-video md:aspect-square rounded-lg overflow-hidden">
                      <Image
                        src={image}
                        alt={title}
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          </AnimatedWrapper>
        );
      },
    },
    ContactSection: {
      label: 'Contact Section',
      permissions: { delete: true, duplicate: true },
      fields: {
        title: { type: 'text', label: 'Section Title' },
        subtitle: { type: 'textarea', label: 'Subtitle (optional)' },
        showMap: {
          type: 'radio',
          label: 'Show Map',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        mapAddress: { type: 'text', label: 'Map Address' },
        contactInfo: {
          type: 'array',
          label: 'Contact Information',
          getItemSummary: (item) => item.label || 'Contact',
          arrayFields: {
            icon: {
              type: 'select',
              label: 'Icon',
              options: getIconOptions(),
            },
            label: { type: 'text', label: 'Label' },
            value: { type: 'text', label: 'Value' },
            link: { type: 'text', label: 'Link (optional)' },
          },
        },
        showForm: {
          type: 'radio',
          label: 'Show Contact Form',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        formTitle: { type: 'text', label: 'Form Title' },
        layout: {
          type: 'select',
          label: 'Layout',
          options: [
            { label: 'Side by Side', value: 'side-by-side' },
            { label: 'Stacked', value: 'stacked' },
          ],
        },
        ...animationFields,
      },
      defaultProps: {
        title: 'Get In Touch',
        subtitle:
          'Have questions? We would love to hear from you. Send us a message and we will respond as soon as possible.',
        showMap: false,
        mapAddress: '',
        contactInfo: [
          {
            icon: 'mail',
            label: 'Email',
            value: 'hello@example.com',
            link: 'mailto:hello@example.com',
          },
          {
            icon: 'phone',
            label: 'Phone',
            value: '+1 (555) 123-4567',
            link: 'tel:+15551234567',
          },
          {
            icon: 'map-pin',
            label: 'Address',
            value: '123 Business St, City, Country',
            link: '',
          },
          {
            icon: 'clock',
            label: 'Hours',
            value: 'Mon-Fri: 9AM - 6PM',
            link: '',
          },
        ],
        showForm: true,
        formTitle: 'Send us a Message',
        layout: 'side-by-side',
        animationType: 'fade-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: ({
        title,
        subtitle,
        showMap,
        mapAddress,
        contactInfo,
        showForm,
        formTitle,
        layout,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) => {
        const formFields: FormField[] = [
          {
            id: 'name',
            type: 'text',
            label: 'Your Name',
            placeholder: 'John Doe',
            required: true,
          },
          {
            id: 'email',
            type: 'email',
            label: 'Email Address',
            placeholder: 'john@example.com',
            required: true,
          },
          {
            id: 'subject',
            type: 'text',
            label: 'Subject',
            placeholder: 'How can we help?',
            required: false,
          },
          {
            id: 'message',
            type: 'textarea',
            label: 'Message',
            placeholder: 'Your message here...',
            required: true,
          },
        ];

        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <section className="py-12 md:py-16 container px-4 md:px-6">
              <div className="max-w-4xl mx-auto text-center mb-10">
                <h2 className="text-3xl font-bold mb-4">{title}</h2>
                {subtitle && (
                  <p className="text-muted-foreground text-lg">{subtitle}</p>
                )}
              </div>

              <div
                className={cn(
                  'max-w-5xl mx-auto',
                  layout === 'side-by-side'
                    ? 'grid md:grid-cols-2 gap-8'
                    : 'space-y-8'
                )}
              >
                {/* Contact Info */}
                <div
                  className={cn(
                    'space-y-6',
                    layout === 'stacked' &&
                      'grid md:grid-cols-2 gap-6 space-y-0'
                  )}
                >
                  {contactInfo?.map(
                    (info: {
                      icon: string;
                      label: string;
                      value: string;
                      link?: string;
                    }) => (
                      <div key={info.label} className="flex items-start gap-4">
                        <div className="p-3 rounded-lg bg-store-primary/10">
                          {renderIcon(info.icon, {
                            className: 'size-5',
                            style: { color: 'var(--store-primary)' },
                          })}
                        </div>
                        <div>
                          <p className="font-medium">{info.label}</p>
                          {info.link ? (
                            <Link
                              href={asRoute(info.link)}
                              className="text-muted-foreground hover:text-store-primary transition-colors"
                            >
                              {info.value}
                            </Link>
                          ) : (
                            <p className="text-muted-foreground">
                              {info.value}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  )}

                  {showMap && mapAddress && (
                    <div className="mt-6 rounded-lg overflow-hidden border">
                      <iframe
                        title="Business location map"
                        width="100%"
                        height="200"
                        style={{ border: 0 }}
                        loading="lazy"
                        allowFullScreen
                        referrerPolicy="no-referrer-when-downgrade"
                        sandbox={MAP_IFRAME_SANDBOX}
                        src={getGoogleMapsQueryEmbedUrl(mapAddress)}
                      />
                    </div>
                  )}
                </div>

                {/* Contact Form */}
                {showForm && (
                  <div className="p-6 md:p-8 border rounded-lg bg-card">
                    <h3 className="text-xl font-bold mb-6">{formTitle}</h3>
                    <StorefrontForm
                      formName="contact"
                      fields={formFields}
                      submitButtonText="Send Message"
                      successMessage="Thank you for your message! We will get back to you soon."
                      merchantId=""
                    />
                  </div>
                )}
              </div>
            </section>
          </AnimatedWrapper>
        );
      },
    },
    LegalSection: {
      label: 'Legal / Policy Section',
      permissions: { delete: true, duplicate: true },
      fields: {
        title: { type: 'text', label: 'Page Title' },
        lastUpdated: { type: 'text', label: 'Last Updated Date' },
        sections: {
          type: 'array',
          label: 'Content Sections',
          getItemSummary: (item) => item.heading || 'Section',
          arrayFields: {
            heading: { type: 'text', label: 'Section Heading' },
            content: { type: 'textarea', label: 'Content' },
          },
        },
        ...animationFields,
      },
      defaultProps: {
        title: 'Privacy Policy',
        lastUpdated: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        sections: [
          {
            heading: 'Introduction',
            content:
              'This Privacy Policy describes how we collect, use, and protect your personal information when you use our services.',
          },
          {
            heading: 'Information We Collect',
            content:
              'We collect information you provide directly to us, such as when you create an account, make a purchase, or contact us for support.',
          },
          {
            heading: 'How We Use Your Information',
            content:
              'We use the information we collect to provide, maintain, and improve our services, process transactions, and communicate with you.',
          },
          {
            heading: 'Contact Us',
            content:
              'If you have any questions about this Privacy Policy, please contact us at privacy@example.com.',
          },
        ],
        animationType: 'fade-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: ({
        title,
        lastUpdated,
        sections,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) => {
        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <section className="py-12 md:py-16 container px-4 md:px-6">
              <div className="max-w-3xl mx-auto">
                <h1 className="text-4xl font-bold mb-4">{title}</h1>
                {lastUpdated && (
                  <p className="text-muted-foreground mb-8">
                    Last updated: {lastUpdated}
                  </p>
                )}
                <div className="prose dark:prose-invert max-w-none space-y-8">
                  {sections?.map(
                    (section: { heading: string; content: string }) => (
                      <div key={section.heading}>
                        <h2 className="text-2xl font-semibold mb-3">
                          {section.heading}
                        </h2>
                        <p className="text-muted-foreground whitespace-pre-wrap">
                          {section.content}
                        </p>
                      </div>
                    )
                  )}
                </div>
              </div>
            </section>
          </AnimatedWrapper>
        );
      },
    },
    CountdownTimer: {
      label: 'Countdown Timer',
      permissions: { delete: true, duplicate: true },
      fields: {
        endDate: { type: 'text', label: 'End Date (YYYY-MM-DD HH:MM)' },
        title: { type: 'text', label: 'Title (optional)' },
        subtitle: { type: 'text', label: 'Subtitle (optional)' },
        expiredMessage: { type: 'text', label: 'Expired Message' },
        style: {
          type: 'select',
          label: 'Style',
          options: [
            { label: 'Boxes', value: 'boxes' },
            { label: 'Inline', value: 'inline' },
            { label: 'Minimal', value: 'minimal' },
          ],
        },
        showDays: {
          type: 'radio',
          label: 'Show Days',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showHours: {
          type: 'radio',
          label: 'Show Hours',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showMinutes: {
          type: 'radio',
          label: 'Show Minutes',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        showSeconds: {
          type: 'radio',
          label: 'Show Seconds',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        ...animationFields,
      },
      defaultProps: {
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 16)
          .replace('T', ' '),
        title: 'Limited Time Offer',
        subtitle: 'Sale ends in:',
        expiredMessage: 'This offer has expired',
        style: 'boxes',
        showDays: true,
        showHours: true,
        showMinutes: true,
        showSeconds: true,
        animationType: 'fade-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: function CountdownTimerRender({
        endDate,
        title,
        subtitle,
        expiredMessage,
        style,
        showDays,
        showHours,
        showMinutes,
        showSeconds,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) {
        const [timeLeft, setTimeLeft] = React.useState({
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
        });
        const [isExpired, setIsExpired] = React.useState(false);

        React.useEffect(() => {
          const calculateTimeLeft = () => {
            const end = new Date(endDate).getTime();
            const now = Date.now();
            const diff = end - now;

            if (diff <= 0) {
              setIsExpired(true);
              return { days: 0, hours: 0, minutes: 0, seconds: 0 };
            }

            return {
              days: Math.floor(diff / (1000 * 60 * 60 * 24)),
              hours: Math.floor(
                (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
              ),
              minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
              seconds: Math.floor((diff % (1000 * 60)) / 1000),
            };
          };

          setTimeLeft(calculateTimeLeft());
          const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft());
          }, 1000);

          return () => clearInterval(timer);
        }, [endDate]);

        const TimeUnit = ({
          value,
          label,
        }: {
          value: number;
          label: string;
        }) => {
          if (style === 'boxes') {
            return (
              <div className="flex flex-col items-center">
                <div className="bg-store-primary text-store-primary-text rounded-lg p-3 md:p-4 min-w-[60px] md:min-w-[80px]">
                  <span className="text-2xl md:text-4xl font-bold">
                    {String(value).padStart(2, '0')}
                  </span>
                </div>
                <span className="text-xs md:text-sm text-muted-foreground mt-2 uppercase tracking-wide">
                  {label}
                </span>
              </div>
            );
          }
          if (style === 'minimal') {
            return (
              <span
                className="text-2xl md:text-3xl font-bold"
                style={{ color: 'var(--store-primary)' }}
              >
                {String(value).padStart(2, '0')}
                <span className="text-sm text-muted-foreground ml-1">
                  {label.charAt(0)}
                </span>
              </span>
            );
          }
          return (
            <span className="text-xl md:text-2xl font-semibold">
              {value}{' '}
              <span className="text-sm text-muted-foreground">{label}</span>
            </span>
          );
        };

        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <section className="py-8 md:py-12 container px-4 md:px-6">
              <div className="text-center max-w-2xl mx-auto">
                {title && (
                  <h2 className="text-2xl md:text-3xl font-bold mb-2">
                    {title}
                  </h2>
                )}
                {subtitle && !isExpired && (
                  <p className="text-muted-foreground mb-6">{subtitle}</p>
                )}

                {isExpired ? (
                  <p className="text-xl text-muted-foreground">
                    {expiredMessage}
                  </p>
                ) : (
                  <div
                    className={cn(
                      'flex justify-center items-center',
                      style === 'boxes' ? 'gap-3 md:gap-4' : 'gap-2 md:gap-4'
                    )}
                  >
                    {showDays && (
                      <TimeUnit value={timeLeft.days} label="Days" />
                    )}
                    {style === 'inline' && showDays && showHours && (
                      <span className="text-2xl">:</span>
                    )}
                    {showHours && (
                      <TimeUnit value={timeLeft.hours} label="Hours" />
                    )}
                    {style === 'inline' && showHours && showMinutes && (
                      <span className="text-2xl">:</span>
                    )}
                    {showMinutes && (
                      <TimeUnit value={timeLeft.minutes} label="Minutes" />
                    )}
                    {style === 'inline' && showMinutes && showSeconds && (
                      <span className="text-2xl">:</span>
                    )}
                    {showSeconds && (
                      <TimeUnit value={timeLeft.seconds} label="Seconds" />
                    )}
                  </div>
                )}
              </div>
            </section>
          </AnimatedWrapper>
        );
      },
    },
    TrustBadges: {
      label: 'Trust Badges',
      permissions: { delete: true, duplicate: true },
      fields: {
        badges: {
          type: 'array',
          label: 'Badges',
          getItemSummary: (item) => item.title || 'Badge',
          arrayFields: {
            icon: {
              type: 'select',
              label: 'Icon',
              options: getIconOptions(),
            },
            title: { type: 'text', label: 'Title' },
            description: { type: 'text', label: 'Description (optional)' },
          },
        },
        layout: {
          type: 'select',
          label: 'Layout',
          options: [
            { label: 'Horizontal', value: 'horizontal' },
            { label: 'Grid', value: 'grid' },
          ],
        },
        style: {
          type: 'select',
          label: 'Style',
          options: [
            { label: 'Cards', value: 'cards' },
            { label: 'Minimal', value: 'minimal' },
            { label: 'Icons Only', value: 'icons-only' },
          ],
        },
        ...animationFields,
      },
      defaultProps: {
        badges: [
          {
            icon: 'shield-check',
            title: 'Secure Payment',
            description: '256-bit SSL encryption',
          },
          {
            icon: 'truck',
            title: 'Free Shipping',
            description: 'On orders over $50',
          },
          {
            icon: 'refresh-cw',
            title: '30-Day Returns',
            description: 'Money-back guarantee',
          },
          {
            icon: 'headphones',
            title: '24/7 Support',
            description: 'We are here to help',
          },
        ],
        layout: 'horizontal',
        style: 'cards',
        animationType: 'fade-in',
        animationDuration: 'normal',
        animationDelay: 0,
        animationTrigger: 'scroll',
      },
      render: ({
        badges,
        layout,
        style,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) => {
        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <section className="py-8 md:py-12 container px-4 md:px-6">
              <div
                className={cn(
                  layout === 'horizontal'
                    ? 'flex flex-wrap justify-center gap-6 md:gap-8'
                    : 'grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6'
                )}
              >
                {badges?.map(
                  (badge: {
                    icon: string;
                    title: string;
                    description?: string;
                  }) => (
                    <div
                      key={badge.title}
                      className={cn(
                        'flex items-center',
                        style === 'cards' &&
                          'flex-col text-center p-4 md:p-6 rounded-lg border bg-card',
                        style === 'minimal' && 'gap-3',
                        style === 'icons-only' && 'flex-col text-center'
                      )}
                    >
                      <div
                        className={cn(
                          'rounded-full flex items-center justify-center',
                          style === 'cards' && 'mb-4 w-16 h-16 bg-primary/10',
                          style === 'minimal' && 'size-12 bg-primary/10',
                          style === 'icons-only' && 'mb-2 size-12 bg-primary/10'
                        )}
                        style={{
                          color: 'var(--store-primary)',
                        }}
                      >
                        {renderIcon(badge.icon, {
                          className: cn(
                            style === 'cards' && 'w-6 h-6 md:w-7 md:h-7',
                            style === 'minimal' && 'size-5',
                            style === 'icons-only' && 'w-7 h-7 md:w-8 md:h-8'
                          ),
                          style: { color: 'var(--store-primary)' },
                        })}
                      </div>
                      {style !== 'icons-only' && (
                        <div className={style === 'minimal' ? '' : ''}>
                          <p
                            className={cn(
                              'font-semibold',
                              style === 'cards' && 'text-sm md:text-base',
                              style === 'minimal' && 'text-sm'
                            )}
                          >
                            {badge.title}
                          </p>
                          {badge.description && style === 'cards' && (
                            <p className="text-xs md:text-sm text-muted-foreground mt-1">
                              {badge.description}
                            </p>
                          )}
                        </div>
                      )}
                      {style === 'icons-only' && (
                        <p className="text-xs font-medium mt-2">
                          {badge.title}
                        </p>
                      )}
                    </div>
                  )
                )}
              </div>
            </section>
          </AnimatedWrapper>
        );
      },
    },
    AnnouncementBar: {
      label: 'Announcement Bar',
      permissions: { delete: true, duplicate: true },
      fields: {
        message: { type: 'text', label: 'Message' },
        linkText: { type: 'text', label: 'Link Text (optional)' },
        linkUrl: { type: 'text', label: 'Link URL (optional)' },
        backgroundColor: {
          type: 'text',
          label: 'Background Color (hex or CSS variable)',
        },
        textColor: { type: 'text', label: 'Text Color (hex or CSS variable)' },
        dismissible: {
          type: 'radio',
          label: 'Dismissible',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
        ...animationFields,
      },
      defaultProps: {
        message: 'Free shipping on all orders over $50!',
        linkText: 'Shop Now',
        linkUrl: '#products',
        backgroundColor: 'var(--store-primary)',
        textColor: 'var(--store-primary-text)',
        dismissible: true,
        animationType: 'slide-down',
        animationDuration: 'fast',
        animationDelay: 0,
        animationTrigger: 'onload',
      },
      render: function AnnouncementBarRender({
        message,
        linkText,
        linkUrl,
        backgroundColor,
        textColor,
        dismissible,
        animationType,
        animationDuration,
        animationDelay,
        animationTrigger,
      }) {
        const [isDismissed, setIsDismissed] = React.useState(false);

        React.useEffect(() => {
          if (typeof window !== 'undefined') {
            const dismissed = localStorage.getItem(
              'baci-announcement-dismissed'
            );
            if (dismissed === 'true') {
              setIsDismissed(true);
            }
          }
        }, []);

        const handleDismiss = () => {
          setIsDismissed(true);
          if (typeof window !== 'undefined') {
            localStorage.setItem('baci-announcement-dismissed', 'true');
          }
        };

        // biome-ignore lint/complexity/noUselessFragments: TypeScript requires JSX.Element return
        if (isDismissed) return <></>;

        return (
          <AnimatedWrapper
            animation={{
              type: mapAnimationType(animationType),
              duration: animationDuration as 'fast' | 'normal' | 'slow',
              delay: animationDelay,
              trigger:
                animationTrigger === 'onload'
                  ? 'immediate'
                  : (animationTrigger as 'scroll' | 'immediate'),
            }}
          >
            <div
              className="relative py-2 px-4 text-center text-sm"
              style={{
                backgroundColor: backgroundColor || 'var(--store-primary)',
                color: textColor || 'var(--store-primary-text)',
              }}
            >
              <div className="container mx-auto flex items-center justify-center gap-2">
                <span>{message}</span>
                {linkText && linkUrl && (
                  <Link
                    href={asRoute(linkUrl)}
                    className="font-semibold underline underline-offset-2 hover:no-underline"
                  >
                    {linkText}
                  </Link>
                )}
              </div>
              {dismissible && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="absolute top-2 right-2 p-1 bg-white/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Dismiss announcement"
                >
                  <svg
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <title>Dismiss</title>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          </AnimatedWrapper>
        );
      },
    },
  },
};
