import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Return to your savings plan',
  robots: { index: false, follow: false },
};

export default function SavingsCardReturnPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-md space-y-6 rounded-3xl border bg-card p-8 text-card-foreground shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">
          Your savings plan
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your contribution in the app
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Returning from checkout does not confirm a payment. Open your wallet
          to check the latest status. Your savings update after the contribution
          is verified and received.
        </p>
        <a
          href="ogabassey://wallet"
          className="flex min-h-12 items-center justify-center rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Return to wallet
        </a>
        <p className="text-sm leading-relaxed text-muted-foreground">
          If the app does not open, close this browser and return to your
          savings plan. Do not start another payment while this one is pending.
        </p>
      </section>
    </main>
  );
}
