interface CartSidebarTotalProps {
  total: number;
}

export function CartSidebarTotal({ total }: CartSidebarTotalProps) {
  return (
    <div className="flex justify-between text-xl font-bold text-store-foreground">
      <span>Total</span>
      <span>₦{total.toLocaleString('en-NG')}</span>
    </div>
  );
}
