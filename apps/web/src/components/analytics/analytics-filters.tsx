'use client';

import { motion } from 'framer-motion';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ADS_ANALYTICS_MAX_DAYS } from '@/lib/analytics/ads-sync-limits';
import { cn } from '@/lib/utils';
import type { AnalyticsCategory } from './analytics-category-nav';

interface AnalyticsFiltersProps {
  category: AnalyticsCategory;
  date: { from: Date | undefined; to: Date | undefined };
  onDateChange: (date: {
    from: Date | undefined;
    to: Date | undefined;
  }) => void;
  onExport?: (format: 'csv' | 'pdf') => void;
  className?: string;
}

export function AnalyticsFilters({
  category,
  date,
  onDateChange,
  onExport,
  className,
}: AnalyticsFiltersProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex items-center justify-between gap-4', className)}
    >
      {category === 'segments' ? (
        <span className="text-sm text-muted-foreground">
          Segments show lifetime data
        </span>
      ) : (
        <DateRangePicker
          date={date}
          maxRangeDays={category === 'ads' ? ADS_ANALYTICS_MAX_DAYS : undefined}
          setDate={onDateChange}
        />
      )}

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full bg-white/60 dark:bg-black/40 backdrop-blur-xl border-none shadow-sm ring-1 ring-black/5 dark:ring-white/10 hover:bg-white/80 dark:hover:bg-black/60"
            >
              <Download className="mr-2 size-4" />
              Export Report
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onExport?.('csv')}>
              <FileSpreadsheet className="mr-2 size-4" />
              Export as CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport?.('pdf')}>
              <FileText className="mr-2 size-4" />
              Export as PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}
