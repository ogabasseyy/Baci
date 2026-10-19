'use client';

import { useEffect, useState } from 'react';
import { scheduleLagosMidnightRefresh } from './schedule-lagos-midnight-refresh';

export function useDeliveryToday(): Date | undefined {
  const [deliveryToday, setDeliveryToday] = useState<Date>();

  useEffect(() => {
    setDeliveryToday(new Date());
    return scheduleLagosMidnightRefresh(() => setDeliveryToday(new Date()));
  }, []);

  return deliveryToday;
}
