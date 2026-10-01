'use client';

import { motion } from 'framer-motion';
import {
  DollarSign,
  LayoutGrid,
  Megaphone,
  Package,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Valid categories for URL parameter validation - derive type from array using as const
export const VALID_CATEGORIES = [
  'overview',
  'finance',
  'products',
  'customers',
  'marketing',
  'inventory',
  'segments',
  'ads',
] as const;

export type AnalyticsCategory = (typeof VALID_CATEGORIES)[number];

interface AnalyticsCategoryNavProps {
  activeCategory: AnalyticsCategory;
  onCategoryChange: (category: AnalyticsCategory) => void;
  visibleCategories?: readonly AnalyticsCategory[];
  className?: string;
}

export function AnalyticsCategoryNav({
  activeCategory,
  onCategoryChange,
  visibleCategories = VALID_CATEGORIES,
  className,
}: AnalyticsCategoryNavProps) {
  const categories: {
    id: AnalyticsCategory;
    label: string;
    icon: React.ElementType;
  }[] = [
    { id: 'overview', label: 'Overview 📊', icon: LayoutGrid },
    { id: 'finance', label: 'Finance 💰', icon: DollarSign },
    { id: 'products', label: 'Products 📦', icon: Package },
    { id: 'inventory', label: 'Inventory 📈', icon: TrendingUp },
    { id: 'customers', label: 'Customers 👥', icon: Users },
    { id: 'segments', label: 'Segments 🎯', icon: Target },
    { id: 'marketing', label: 'Marketing 📣', icon: Megaphone },
    { id: 'ads', label: 'Ad Conversions ⚡', icon: Zap },
  ];

  return (
    <div
      className={cn(
        'flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide',
        className
      )}
    >
      {categories
        .filter((category) => visibleCategories.includes(category.id))
        .map((category) => {
          const isActive = activeCategory === category.id;
          const Icon = category.icon;

          return (
            <button
              type="button"
              key={category.id}
              onClick={() => onCategoryChange(category.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                isActive
                  ? 'text-white'
                  : 'text-foreground/70 hover:text-foreground hover:bg-muted/50'
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeCategory"
                  className="absolute inset-0 bg-primary rounded-full shadow-md shadow-primary/25"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Icon className="size-4" />
                {category.label}
              </span>
            </button>
          );
        })}
    </div>
  );
}
