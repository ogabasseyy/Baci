'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function Merchant360Error({ reset }: { reset: () => void }) {
  return (
    <Card role="alert">
      <CardHeader>
        <CardTitle>Merchant operations could not load</CardTitle>
        <CardDescription>
          Try again. No merchant data was changed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={reset}>Try again</Button>
      </CardContent>
    </Card>
  );
}
