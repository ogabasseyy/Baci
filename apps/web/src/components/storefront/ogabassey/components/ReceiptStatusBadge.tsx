import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import type React from 'react';

export const ReceiptStatusBadge: React.FC<{ status: string }> = ({
  status,
}) => {
  switch (status) {
    case 'Paid':
      return (
        <span className="bg-green-50 text-green-700 text-[10px] font-bold px-2.5 py-1 rounded-full border border-green-100 flex items-center gap-1 w-fit">
          <CheckCircle2 size={12} /> Paid
        </span>
      );
    case 'Partially Paid':
      return (
        <span className="bg-yellow-50 text-yellow-700 text-[10px] font-bold px-2.5 py-1 rounded-full border border-yellow-100 flex items-center gap-1 w-fit">
          <Clock size={12} /> Partial
        </span>
      );
    default:
      return (
        <span className="bg-red-50 text-red-700 text-[10px] font-bold px-2.5 py-1 rounded-full border border-red-100 flex items-center gap-1 w-fit">
          <AlertCircle size={12} /> Unpaid
        </span>
      );
  }
};
