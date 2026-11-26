'use client';

import type {
  OnboardingChatData,
  OnboardingChatMessage,
} from '@baci/shared/onboarding-chat';
import { Sparkles } from 'lucide-react';
import Image from 'next/image';
import {
  getWebBusinessTypeLabel,
  getWebCountryName,
} from './web-onboarding-chat-helpers';

interface ChatMessageBubbleProps {
  message: OnboardingChatMessage;
  data: OnboardingChatData;
}

export function ChatMessageBubble({ message, data }: ChatMessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <li className="flex justify-center">
        <p
          role="status"
          className="max-w-md rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive"
        >
          {message.text}
        </p>
      </li>
    );
  }

  return (
    <li className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser ? (
        <span
          aria-hidden="true"
          className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <Sparkles className="size-4" />
        </span>
      ) : null}

      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
          isUser
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm border border-border bg-card text-card-foreground'
        }`}
      >
        <p className="whitespace-pre-line">{message.text}</p>

        {message.logoPreviewUri ? (
          <div className="mt-3 space-y-2 rounded-xl border border-border bg-background p-3">
            <Image
              src={message.logoPreviewUri}
              alt="Store logo preview"
              width={112}
              height={112}
              unoptimized
              className="mx-auto size-28 rounded-lg object-contain"
            />
            {message.brandColors ? (
              <div className="flex items-center justify-center gap-2 pt-1">
                {(
                  [
                    ['Primary', message.brandColors.primary],
                    ['Background', message.brandColors.background],
                    ['Accent', message.brandColors.accent],
                  ] as const
                ).map(([label, hex]) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-full border border-border"
                      style={{ backgroundColor: hex }}
                    />
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {message.isSummary ? (
          <dl className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-border bg-background p-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Store Name</dt>
              <dd className="font-medium text-foreground">
                {data.businessName}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Store Link</dt>
              <dd className="font-medium text-foreground">
                {data.slug}.usebaci.com
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Category</dt>
              <dd className="font-medium text-foreground">
                {getWebBusinessTypeLabel(
                  data.businessType,
                  data.otherBusinessType
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Country</dt>
              <dd className="font-medium text-foreground">
                {getWebCountryName(data.country)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Phone</dt>
              <dd className="font-medium text-foreground">
                {data.phone || 'Not added yet'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Logo</dt>
              <dd className="font-medium text-foreground">
                {data.logoUrl ? 'Ready' : 'Skipped for now'}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </li>
  );
}
