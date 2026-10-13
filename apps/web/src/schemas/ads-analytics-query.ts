import { z } from 'zod';
import {
  ADS_ANALYTICS_MAX_DAYS,
  getInclusiveAdsDateRangeDays,
} from '@/lib/analytics/ads-sync-limits';

const calendarDate = z.iso.date();
const orderInstant = z.iso.datetime({ offset: true });

/**
 * Provider spend rows use account-local calendar dates, while order
 * attribution follows the dashboard's exact selected instants. Keep both
 * boundaries explicit so the two data sources cannot silently drift.
 */
export const adsAnalyticsQuerySchema = z
  .object({
    cacheBust: z
      .string()
      .regex(/^\d{1,10}$/)
      .optional(),
    endDate: calendarDate.optional(),
    orderEnd: orderInstant.optional(),
    orderStart: orderInstant.optional(),
    startDate: calendarDate.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.orderStart || value.orderEnd) {
      if (!value.orderStart || !value.orderEnd) {
        if (!value.orderStart) {
          ctx.addIssue({
            code: 'custom',
            message: 'orderStart and orderEnd must be provided together',
            path: ['orderStart'],
          });
        }
        if (!value.orderEnd) {
          ctx.addIssue({
            code: 'custom',
            message: 'orderStart and orderEnd must be provided together',
            path: ['orderEnd'],
          });
        }
      } else if (Date.parse(value.orderStart) > Date.parse(value.orderEnd)) {
        ctx.addIssue({
          code: 'custom',
          message: 'orderStart must be on or before orderEnd',
          path: ['orderStart'],
        });
      } else {
        // The exact order boundaries may be local instants whose elapsed
        // duration crosses a DST transition. Measure the same calendar
        // window used by provider spend rows so a valid 366-day selection is
        // not rejected merely because the local day was 23 or 25 hours long.
        const orderCalendarDays = getInclusiveAdsDateRangeDays(
          value.orderStart.slice(0, 10),
          value.orderEnd.slice(0, 10)
        );
        const selectedCalendarDays =
          value.startDate && value.endDate
            ? getInclusiveAdsDateRangeDays(value.startDate, value.endDate)
            : undefined;
        const orderWindowExceedsLimit =
          orderCalendarDays > ADS_ANALYTICS_MAX_DAYS &&
          (selectedCalendarDays === undefined ||
            orderCalendarDays > selectedCalendarDays + 1);
        if (orderWindowExceedsLimit) {
          ctx.addIssue({
            code: 'custom',
            message: `Order reporting range cannot exceed ${ADS_ANALYTICS_MAX_DAYS} days`,
            path: ['orderEnd'],
          });
        }
      }
    }

    if (!value.startDate && !value.endDate) return;

    if (!value.startDate || !value.endDate) {
      if (!value.startDate) {
        ctx.addIssue({
          code: 'custom',
          message: 'startDate and endDate must be provided together',
          path: ['startDate'],
        });
      }
      if (!value.endDate) {
        ctx.addIssue({
          code: 'custom',
          message: 'startDate and endDate must be provided together',
          path: ['endDate'],
        });
      }
      return;
    }

    if (value.startDate > value.endDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'startDate must be on or before endDate',
        path: ['startDate'],
      });
      return;
    }

    const inclusiveDays = getInclusiveAdsDateRangeDays(
      value.startDate,
      value.endDate
    );
    if (inclusiveDays > ADS_ANALYTICS_MAX_DAYS) {
      ctx.addIssue({
        code: 'custom',
        message: `Reporting range cannot exceed ${ADS_ANALYTICS_MAX_DAYS} days`,
        path: ['endDate'],
      });
    }
  });
