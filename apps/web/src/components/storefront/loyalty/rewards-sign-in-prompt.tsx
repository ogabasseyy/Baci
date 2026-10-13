'use client';

import { Award, Gift, Sparkles, Trophy } from 'lucide-react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Signed-out state for the rewards page (split out: 300-line limit).
export function RewardsSignInPrompt({ slug }: { slug: string }) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center size-16 bg-store-primary/10 rounded-full mb-4">
          <Sparkles className="size-8 text-store-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Rewards Program</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Sign in to your account to view your rewards, earn points, and redeem
          exclusive offers
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sign in to access rewards</CardTitle>
          <CardDescription>
            Already have an account? Sign in to view your points and rewards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={`/${slug}/account/login?redirect=/${slug}/pages/rewards`}
            className="inline-flex items-center justify-center w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Sign In to Continue
          </Link>
        </CardContent>
      </Card>

      {/* Show benefits preview */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Member Benefits</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Sparkles,
              title: 'Earn Points',
              description: 'Get points on every purchase',
            },
            {
              icon: Gift,
              title: 'Redeem Rewards',
              description: 'Exchange points for discounts',
            },
            {
              icon: Trophy,
              title: 'Unlock Tiers',
              description: 'Rise through member levels',
            },
            {
              icon: Award,
              title: 'Exclusive Access',
              description: 'Early access to sales',
            },
          ].map((benefit) => (
            <Card key={benefit.title}>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center">
                  <div className="p-3 bg-store-primary/10 rounded-full mb-3">
                    <benefit.icon className="size-6 text-store-primary" />
                  </div>
                  <h3 className="font-medium mb-1">{benefit.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {benefit.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
