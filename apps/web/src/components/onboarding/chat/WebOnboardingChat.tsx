'use client';

import { ArrowUp, Eye, EyeOff, Globe, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { OnboardingPuckPreview } from '@/components/onboarding-puck-preview';
import { PasswordStrengthIndicator } from '@/components/password-strength-indicator';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { checkPasswordStrength } from '@/lib/utils';
import { ChatMessageBubble } from './ChatMessageBubble';
import { LogoDropzoneChip } from './LogoDropzoneChip';
import { useWebOnboardingChat } from './use-web-onboarding-chat';
import { WEB_COUNTRIES } from './web-onboarding-chat-helpers';
import {
  getWebQuickRepliesForStep,
  getWebStepInputConfig,
} from './web-onboarding-chat-prompts';

export default function WebOnboardingChat() {
  const chat = useWebOnboardingChat();
  const [showPassword, setShowPassword] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const quickReplies = getWebQuickRepliesForStep({
    step: chat.step,
    suggestedNames: chat.suggestedNames,
    logoPreviewSource: chat.logoPreviewSource,
    isCustomizingSlug: chat.isCustomizingSlug,
    hasRejectedSlug: chat.hasRejectedSlug,
    isLaunching: chat.isLaunching,
  });

  const inputConfig = getWebStepInputConfig(chat.step, chat.isCustomizingSlug);
  const isPasswordStep =
    chat.step === 'auth_password' || chat.step === 'auth_confirm';
  const filteredCountries = countrySearch.trim()
    ? WEB_COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(countrySearch.trim().toLowerCase()) ||
          c.code.toLowerCase().includes(countrySearch.trim().toLowerCase())
      )
    : WEB_COUNTRIES;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to bottom whenever messages or loading state updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.messages.length, chat.isBusy]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-3 py-4 sm:px-6 lg:py-6">
      <header className="mb-4 flex items-center justify-between">
        <Link
          href="/"
          aria-label="Baci home"
          className="inline-flex items-center"
        >
          <Logo width={88} height={28} priority />
        </Link>
        <div className="text-xs text-muted-foreground">
          {chat.user ? (
            <span>Signed in as {chat.user.email}</span>
          ) : (
            <span>
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-medium text-primary underline underline-offset-4"
              >
                Sign in
              </Link>
            </span>
          )}
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section
          aria-label="Store setup chat"
          className="flex h-[calc(100dvh-6.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card/90 shadow-lg backdrop-blur-sm"
        >
          <div className="border-b border-border px-4 py-3">
            <h1 className="text-base font-semibold text-foreground">
              Set up your Baci store
            </h1>
            <p className="text-xs text-muted-foreground">
              Chat with Baci to create your store in minutes — no long forms.
            </p>
          </div>

          <div
            className="flex-1 overflow-y-auto px-4 py-4"
            aria-live="polite"
            aria-busy={chat.isBusy || chat.isHydrating}
          >
            {chat.isHydrating ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading your setup…
              </div>
            ) : (
              <ol className="space-y-4">
                {chat.messages.map((message) => (
                  <ChatMessageBubble
                    key={message.id}
                    message={message}
                    data={chat.data}
                  />
                ))}
                {chat.isBusy ? (
                  <li className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    <span>Baci is working on that…</span>
                  </li>
                ) : null}
              </ol>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border bg-background/80 px-4 py-3">
            {chat.step === 'logo' && !chat.logoPreviewSource ? (
              <LogoDropzoneChip
                disabled={chat.isBusy}
                fileInputRef={chat.fileInputRef}
                onFileSelected={(file) => void chat.handleFileUpload(file)}
              />
            ) : (
              <input
                ref={chat.fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="Upload store logo file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void chat.handleFileUpload(file);
                  event.target.value = '';
                }}
              />
            )}

            {quickReplies.length > 0 ? (
              <fieldset
                className="mb-3 flex flex-wrap gap-2 border-0 p-0"
                aria-label="Quick replies"
              >
                {quickReplies.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    size="sm"
                    disabled={chat.isBusy}
                    variant={
                      option.variant === 'accent'
                        ? 'default'
                        : option.variant === 'secondary'
                          ? 'secondary'
                          : 'outline'
                    }
                    className="rounded-full text-xs"
                    onClick={() => chat.handleQuickReply(option)}
                  >
                    {option.label}
                  </Button>
                ))}
              </fieldset>
            ) : null}

            {chat.step === 'auth_password' && chat.inputText ? (
              <div className="mb-2">
                <PasswordStrengthIndicator
                  strength={checkPasswordStrength(chat.inputText)}
                />
              </div>
            ) : null}

            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                chat.handleSendText();
              }}
            >
              <div className="relative flex-1">
                <Input
                  type={
                    isPasswordStep && !showPassword
                      ? 'password'
                      : inputConfig.inputType === 'password'
                        ? 'text'
                        : inputConfig.inputType
                  }
                  value={chat.inputText}
                  disabled={chat.isBusy || chat.step === 'auth_check_email'}
                  onChange={(event) => chat.setInputText(event.target.value)}
                  placeholder={inputConfig.placeholder}
                  aria-label={inputConfig.accessibilityLabel}
                  className={isPasswordStep ? 'pr-10' : undefined}
                />
                {isPasswordStep ? (
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                ) : null}
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={
                  chat.isBusy ||
                  !chat.inputText.trim() ||
                  chat.step === 'auth_check_email'
                }
                aria-label="Send response"
              >
                <ArrowUp className="size-4" />
              </Button>
            </form>
          </div>
        </section>

        <aside
          aria-label="Live storefront preview"
          className="hidden h-[calc(100dvh-6.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card/90 shadow-lg lg:flex"
        >
          <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <Globe className="size-3.5 shrink-0 text-primary" />
            <span className="truncate font-mono">
              https://{chat.data.slug || 'your-store'}.usebaci.com
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <OnboardingPuckPreview
              businessName={chat.data.businessName || 'Your Store'}
              businessType={chat.data.businessType || 'other'}
              logoDataUri={chat.logoDraftUri || undefined}
              brandColors={chat.data.brandColors}
            />
          </div>
        </aside>
      </div>

      <Dialog
        open={chat.isCountryModalOpen}
        onOpenChange={chat.setIsCountryModalOpen}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select your country</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={countrySearch}
              onChange={(event) => setCountrySearch(event.target.value)}
              placeholder="Search countries..."
              aria-label="Search countries"
              className="pl-9"
            />
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {filteredCountries.map((country) => (
              <li key={country.code}>
                <button
                  type="button"
                  onClick={() => {
                    setCountrySearch('');
                    chat.handleSelectCountry(country.code, country.name);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span aria-hidden="true">{country.flag}</span>
                  <span>{country.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
