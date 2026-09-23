const DELIVERY_DATE_FORMATTER: Intl.DateTimeFormat = new Intl.DateTimeFormat(
  'en-US',
  {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }
);

export function getDeliveryEstimate(
  deliveryLocation: 'Lagos' | 'Outside Lagos',
  today?: Date
) {
  if (!today) return 'Available shortly';
  const minDays = deliveryLocation === 'Lagos' ? 1 : 3;
  const maxDays = deliveryLocation === 'Lagos' ? 2 : 5;

  const formatDate = (daysToAdd: number) => {
    const date = new Date(today);
    date.setDate(today.getDate() + daysToAdd);
    return DELIVERY_DATE_FORMATTER.format(date);
  };

  return `${formatDate(minDays)} - ${formatDate(maxDays)}`;
}
