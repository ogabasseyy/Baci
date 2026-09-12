import { formatPickerDateInput } from './transaction-review-inputs';

export function getManualOrderDocumentDates(orderDate: Date) {
  const calendarDate = formatPickerDateInput(orderDate);

  return {
    invoice_issue_date: calendarDate,
    tax_point_date: calendarDate,
  };
}
