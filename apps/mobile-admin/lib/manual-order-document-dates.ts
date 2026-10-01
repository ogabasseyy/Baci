import { formatPickerDateInput } from './transaction-review-inputs';

export function getManualOrderDocumentDates(orderDate: Date) {
  if (Number.isNaN(orderDate.getTime())) {
    throw new Error('Invalid order date');
  }

  const calendarDate = formatPickerDateInput(orderDate);

  return {
    invoice_issue_date: calendarDate,
    tax_point_date: calendarDate,
  };
}
