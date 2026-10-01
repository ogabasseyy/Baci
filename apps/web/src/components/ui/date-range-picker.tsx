'use client';

import { addDays, format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DateRangePickerProps {
  date: {
    from: Date | undefined;
    to: Date | undefined;
  };
  setDate: (date: { from: Date | undefined; to: Date | undefined }) => void;
  className?: string;
  maxRangeDays?: number;
}

export function DateRangePicker({
  date,
  setDate,
  className,
  maxRangeDays,
}: DateRangePickerProps) {
  const maxDate =
    date.from && !date.to && maxRangeDays && maxRangeDays > 0
      ? addDays(date.from, Math.floor(maxRangeDays) - 1)
      : undefined;

  return (
    <div className={cn('grid gap-2', className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={'outline'}
            className={cn(
              'w-[260px] justify-start text-left font-normal bg-white/60 dark:bg-black/40 backdrop-blur-xl border-none shadow-sm ring-1 ring-black/5 dark:ring-white/10 hover:bg-white/80 dark:hover:bg-black/60',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 size-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, 'LLL dd, y')} -{' '}
                  {format(date.to, 'LLL dd, y')}
                </>
              ) : (
                format(date.from, 'LLL dd, y')
              )
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="p-3 bg-background border rounded-md shadow-lg">
            <DatePicker
              selected={date.from}
              onChange={(dates) => {
                const [start, end] = dates as [Date | null, Date | null];
                setDate({ from: start || undefined, to: end || undefined });
              }}
              startDate={date.from}
              endDate={date.to}
              maxDate={maxDate}
              selectsRange
              inline
              monthsShown={2}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
