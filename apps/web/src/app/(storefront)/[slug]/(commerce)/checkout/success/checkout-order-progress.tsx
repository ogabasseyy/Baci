'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, MapPin, Package, Truck } from 'lucide-react';

const orderSteps = [
  { id: 'received', label: 'Order Received', icon: CheckCircle2 },
  { id: 'processing', label: 'Processing', icon: Package },
  { id: 'shipped', label: 'Shipped', icon: Truck },
  { id: 'delivered', label: 'Delivered', icon: MapPin },
];

export function CheckoutOrderProgress({
  isConfirmed,
  isInvoice,
}: {
  isConfirmed: boolean;
  isInvoice: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6"
    >
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-6">
        Order Progress
      </h2>
      <div className="relative">
        {/* Progress Line */}
        <div className="absolute top-5 left-5 right-5 h-0.5 bg-gray-100 hidden md:block" />
        <div
          className="absolute top-5 left-5 h-0.5 bg-green-500 hidden md:block transition-all duration-500"
          style={{ width: isConfirmed ? 'calc(25% - 10px)' : '0%' }}
        />

        {/* Steps */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {orderSteps.map((step, index) => {
            const isActive = index === 0;
            const isCompleted = isConfirmed && index === 0;
            const StepIcon = step.icon;
            let stepLabel = step.label;
            if (step.id === 'received' && isInvoice) {
              stepLabel = 'Invoice Generated';
            }

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 + index * 0.1 }}
                className="flex flex-col items-center text-center"
              >
                <div
                  className={`size-10 rounded-full flex items-center justify-center mb-2 transition-all ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isActive
                        ? 'bg-green-100 text-green-600 ring-2 ring-green-500 ring-offset-2'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  <StepIcon className="size-5" />
                </div>
                <span
                  className={`text-xs font-medium ${
                    isActive ? 'text-green-600' : 'text-gray-500'
                  }`}
                >
                  {stepLabel}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
