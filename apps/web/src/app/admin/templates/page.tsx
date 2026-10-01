'use client';

import { LayoutTemplate, Lock } from 'lucide-react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TEMPLATES } from '@/config/templates';

export default function AdminTemplatesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Template Catalogue
          </h1>
          <p className="text-muted-foreground">
            Review the storefront templates currently available to merchants.
          </p>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {TEMPLATES.map((template) => (
          <Card key={template.id} className="overflow-hidden flex flex-col">
            <div className="aspect-video relative bg-muted">
              {template.previewImage ? (
                <Image
                  src={template.previewImage}
                  alt={template.name}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  className="object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <LayoutTemplate className="size-10" aria-hidden="true" />
                </div>
              )}
              {template.isPremium && (
                <div className="absolute top-2 right-2">
                  <Badge
                    variant="secondary"
                    className="bg-amber-100 text-amber-800 hover:bg-amber-100"
                  >
                    <Lock className="size-3 mr-1" aria-hidden="true" /> Premium
                  </Badge>
                </div>
              )}
            </div>
            <CardHeader className="p-4">
              <CardTitle className="text-lg">{template.name}</CardTitle>
              <CardDescription className="line-clamp-2">
                {template.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 mt-auto">
              <div className="text-xs text-muted-foreground">
                ID: <span className="font-mono">{template.id}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
