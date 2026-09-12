'use client';

import { ChevronRight, Loader2 } from 'lucide-react';
import type React from 'react';
import { useCurrency } from '@/hooks/use-currency';
export { MobileOrderSummary } from './MobileOrderSummary';

// --- Types ---

interface MobileCheckoutActionsProps {
    currentStep: 'contact' | 'delivery' | 'payment';
    completedSteps: { contact: boolean; delivery: boolean };
    onNext: () => void;
    isProcessing: boolean;
    totalDisplay: number; // The amount to show in the bar (remaining amount)
    paymentMethod: string;
    isPayForMeValid: boolean;
    originalTotal: number;
}


// --- Components ---

export const MobileCheckoutActions: React.FC<MobileCheckoutActionsProps> = ({
    currentStep,
    completedSteps,
    onNext,
    isProcessing,
    totalDisplay,
    paymentMethod,
    isPayForMeValid,
}) => {
    const { formatCurrencyAuto } = useCurrency();
    // Determine button text and disabled state based on step
    let buttonText = 'Continue';
    let isDisabled = false;

    if (currentStep === 'contact') {
        buttonText = 'Continue to Delivery';
        // Logic for contact disabled state is handled inside the click handler via validation
        // but we can pass validation status if needed. For now, rely on parent validation.
    } else if (currentStep === 'delivery') {
        buttonText = 'Continue to Payment';
        isDisabled = !completedSteps.contact; // Can't skip to delivery if contact not done
    } else if (currentStep === 'payment') {
        if (paymentMethod === 'invoice') buttonText = 'Generate Invoice';
        else if (paymentMethod === 'payforme') buttonText = 'Send Payment Link';
        else buttonText = 'Place Order';

        // Disable if amount remains but no method selected
        if (totalDisplay > 0 && !paymentMethod) isDisabled = true;
        if (paymentMethod === 'payforme' && !isPayForMeValid) isDisabled = true;
    }

    return (
        <div className="fixed bottom-20 left-0 right-0 bg-white border-t border-gray-200 p-4 pb-safe-area lg:hidden z-50 shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
            <div className="flex items-center gap-4">
                {/* Total displayed next to button for context */}
                <div className="shrink-0">
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Total</p>
                    <p className="text-lg font-bold text-gray-900 leading-tight">
                        {formatCurrencyAuto(totalDisplay)}
                    </p>
                </div>

                <button type="button"
                    onClick={onNext}
                    disabled={isDisabled || isProcessing}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg hover:shadow-red-200"
                >
                    {isProcessing ? (
                        <Loader2 className="animate-spin" size={20} />
                    ) : (
                        <>
                            {buttonText}
                            <ChevronRight size={18} />
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};
