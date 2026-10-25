'use client';

import {
  Clock,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { StorefrontFooter } from '@/components/storefront/footer';
import { StorefrontHeader } from '@/components/storefront/header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SafeHtml } from '@/components/ui/safe-html';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { fetchWithCsrf } from '@/lib/api-client';

import { ContentPageProviders } from '../content-page-providers';

interface ContactPageClientProps {
  merchant: {
    id: string;
    slug: string;
    business_name: string;
    logo_url?: string;
    email?: string;
    phone?: string;
    address?: string;
    brand_colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      background?: string;
    };
    pages?: {
      contact?: string;
    };
    business_hours?: {
      monday?: string;
      tuesday?: string;
      wednesday?: string;
      thursday?: string;
      friday?: string;
      saturday?: string;
      sunday?: string;
    };
  };
  legacyContent?: string;
  children?: ReactNode;
}

interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

// Module-scope helper: keeps try/catch out of the component body so React
// Compiler can optimize the component.
async function submitContactForm(
  merchantId: string,
  formData: ContactFormData
): Promise<boolean> {
  try {
    const response = await fetchWithCsrf('/api/forms/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId,
        formName: 'contact',
        formData,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function ContactPageClient({
  merchant,
  legacyContent,
  children,
}: ContactPageClientProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const sent = await submitContactForm(merchant.id, formData);

    if (sent) {
      toast({
        title: 'Message Sent!',
        description: "We'll get back to you as soon as possible.",
      });
      setFormData({ name: '', email: '', subject: '', message: '' });
    } else {
      toast({
        title: 'Error',
        description: 'Failed to send message. Please try again.',
        variant: 'destructive',
      });
    }

    setIsSubmitting(false);
  };

  const hasContactDetails =
    merchant.email || merchant.phone || merchant.address;

  return (
    <ContentPageProviders merchant={merchant}>
      <div className="flex flex-col min-h-screen">
        <StorefrontHeader />

        <main className="flex-1">
          {/* Hero Section */}
          <section className="relative py-16 md:py-20 bg-linear-to-b from-muted/50 to-background">
            <div className="container px-4 md:px-6 text-center">
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-primary/10 rounded-full">
                  <MessageSquare className="size-10 text-primary" />
                </div>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
                Contact Us
              </h1>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Have a question or need help? We'd love to hear from you.
              </p>
            </div>
          </section>

          {/* Contact Content */}
          <div className="container px-4 md:px-6 py-12 md:py-16">
            <div className="grid lg:grid-cols-2 gap-12 max-w-6xl mx-auto">
              {/* Contact Form */}
              <div>
                <h2 className="text-2xl font-bold mb-6">Send us a message</h2>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input
                        id="name"
                        placeholder="Your name"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="your@email.com"
                        value={formData.email}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            email: e.target.value,
                          })
                        }
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="subject">Subject</Label>
                    <Input
                      id="subject"
                      placeholder="What's this about?"
                      value={formData.subject}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          subject: e.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Message</Label>
                    <Textarea
                      id="message"
                      placeholder="Tell us how we can help..."
                      rows={6}
                      value={formData.message}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          message: e.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full sm:w-auto"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 size-4" />
                        Send Message
                      </>
                    )}
                  </Button>
                </form>
              </div>

              {/* Contact Info */}
              <div>
                <h2 className="text-2xl font-bold mb-6">Get in touch</h2>

                {hasContactDetails && (
                  <div className="space-y-4 mb-8">
                    {merchant.email && (
                      <Card>
                        <CardContent className="flex items-center gap-4 p-4">
                          <div className="p-3 bg-primary/10 rounded-full">
                            <Mail className="size-5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">
                              Email
                            </p>
                            <a
                              href={`mailto:${merchant.email}`}
                              className="font-medium hover:text-primary transition-colors"
                            >
                              {merchant.email}
                            </a>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {merchant.phone && (
                      <Card>
                        <CardContent className="flex items-center gap-4 p-4">
                          <div className="p-3 bg-primary/10 rounded-full">
                            <Phone className="size-5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">
                              Phone
                            </p>
                            <a
                              href={`tel:${merchant.phone}`}
                              className="font-medium hover:text-primary transition-colors"
                            >
                              {merchant.phone}
                            </a>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {merchant.address && (
                      <Card>
                        <CardContent className="flex items-center gap-4 p-4">
                          <div className="p-3 bg-primary/10 rounded-full">
                            <MapPin className="size-5 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm text-muted-foreground">
                              Address
                            </p>
                            <p className="font-medium">{merchant.address}</p>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {merchant.business_hours && (
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="p-3 bg-primary/10 rounded-full">
                              <Clock className="size-5 text-primary" />
                            </div>
                            <p className="font-medium">Business Hours</p>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm ml-14">
                            {merchant.business_hours.monday && (
                              <div>
                                <span className="text-muted-foreground">
                                  Mon:
                                </span>{' '}
                                {merchant.business_hours.monday}
                              </div>
                            )}
                            {merchant.business_hours.tuesday && (
                              <div>
                                <span className="text-muted-foreground">
                                  Tue:
                                </span>{' '}
                                {merchant.business_hours.tuesday}
                              </div>
                            )}
                            {merchant.business_hours.wednesday && (
                              <div>
                                <span className="text-muted-foreground">
                                  Wed:
                                </span>{' '}
                                {merchant.business_hours.wednesday}
                              </div>
                            )}
                            {merchant.business_hours.thursday && (
                              <div>
                                <span className="text-muted-foreground">
                                  Thu:
                                </span>{' '}
                                {merchant.business_hours.thursday}
                              </div>
                            )}
                            {merchant.business_hours.friday && (
                              <div>
                                <span className="text-muted-foreground">
                                  Fri:
                                </span>{' '}
                                {merchant.business_hours.friday}
                              </div>
                            )}
                            {merchant.business_hours.saturday && (
                              <div>
                                <span className="text-muted-foreground">
                                  Sat:
                                </span>{' '}
                                {merchant.business_hours.saturday}
                              </div>
                            )}
                            {merchant.business_hours.sunday && (
                              <div>
                                <span className="text-muted-foreground">
                                  Sun:
                                </span>{' '}
                                {merchant.business_hours.sunday}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}

                {/* Legacy content */}
                {legacyContent && (
                  <SafeHtml
                    html={legacyContent}
                    className="prose prose-sm dark:prose-invert max-w-none"
                  />
                )}
              </div>
            </div>
          </div>
          {children}
        </main>

        <StorefrontFooter />
      </div>
    </ContentPageProviders>
  );
}
