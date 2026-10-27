'use client';

import {
  Award,
  Calendar,
  CheckCircle,
  ExternalLink,
  Play,
  Quote,
  Star,
  Trophy,
  Users,
} from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { StorefrontFooter } from '@/components/storefront/footer';
import { StorefrontHeader } from '@/components/storefront/header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SafeHtml } from '@/components/ui/safe-html';
import { getVideoEmbedUrl } from '@/lib/video-embed';
import {
  hasAnyRenderedAboutField,
  type MerchantAboutPage,
} from '@/types/about-page';

import { ContentPageProviders } from '../content-page-providers';

interface AboutPageClientProps {
  merchant: {
    id: string;
    slug: string;
    business_name: string;
    logo_url?: string;
    brand_colors?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      background?: string;
    };
    pages?: {
      about?: string;
    };
  };
  aboutPage: MerchantAboutPage;
  legacyContent?: string;
  children?: ReactNode;
}

const ABOUT_VIDEO_IFRAME_SANDBOX =
  'allow-same-origin allow-scripts allow-presentation allow-popups allow-popups-to-escape-sandbox';

export function AboutPageClient({
  merchant,
  aboutPage,
  legacyContent,
  children,
}: AboutPageClientProps) {
  const hasStructuredContent = hasAnyRenderedAboutField(aboutPage);

  return (
    <ContentPageProviders merchant={merchant}>
      <div className="flex flex-col min-h-screen">
        <StorefrontHeader />

        <main className="flex-1">
          {/* Hero Section */}
          <section className="relative py-16 md:py-24 bg-linear-to-b from-muted/50 to-background">
            <div className="container px-4 md:px-6 text-center">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
                About {merchant.business_name}
              </h1>
              {aboutPage.mission && (
                <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto">
                  {aboutPage.mission}
                </p>
              )}
            </div>
          </section>

          {/* Main Content */}
          <div className="container px-4 md:px-6 py-12 md:py-16">
            {hasStructuredContent ? (
              <div className="space-y-16">
                {/* Our Story */}
                {aboutPage.story && (
                  <section className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-bold mb-6 flex items-center gap-3">
                      <Quote className="size-8 text-primary" />
                      Our Story
                    </h2>
                    <SafeHtml
                      html={aboutPage.story}
                      className="prose prose-lg dark:prose-invert max-w-none"
                    />
                  </section>
                )}

                {/* Vision & Values */}
                {(aboutPage.vision || aboutPage.values?.length) && (
                  <section className="max-w-4xl mx-auto">
                    <div className="grid md:grid-cols-2 gap-8">
                      {aboutPage.vision && (
                        <Card className="bg-primary/5 border-primary/20">
                          <CardContent className="pt-6">
                            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                              <Star className="size-5 text-primary" />
                              Our Vision
                            </h3>
                            <p className="text-muted-foreground">
                              {aboutPage.vision}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                      {aboutPage.values && aboutPage.values.length > 0 && (
                        <Card className="bg-accent/5 border-accent/20">
                          <CardContent className="pt-6">
                            <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                              <CheckCircle className="size-5 text-accent" />
                              Our Values
                            </h3>
                            <ul className="space-y-2">
                              {aboutPage.values.map((value) => (
                                <li
                                  key={value}
                                  className="flex items-center gap-2 text-muted-foreground"
                                >
                                  <span className="size-1.5 rounded-full bg-primary" />
                                  {value}
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </section>
                )}

                {/* Social Proof Stats */}
                {aboutPage.social_proof && (
                  <section className="py-8 bg-muted/30 rounded-2xl">
                    <div className="container px-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                        {aboutPage.social_proof.years_in_business && (
                          <div>
                            <div className="text-3xl md:text-4xl font-bold text-primary">
                              {aboutPage.social_proof.years_in_business}+
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Years in Business
                            </div>
                          </div>
                        )}
                        {aboutPage.social_proof.customers_served && (
                          <div>
                            <div className="text-3xl md:text-4xl font-bold text-primary">
                              {aboutPage.social_proof.customers_served.toLocaleString()}
                              +
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Happy Customers
                            </div>
                          </div>
                        )}
                        {aboutPage.social_proof.products_sold && (
                          <div>
                            <div className="text-3xl md:text-4xl font-bold text-primary">
                              {aboutPage.social_proof.products_sold.toLocaleString()}
                              +
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Products Sold
                            </div>
                          </div>
                        )}
                        {aboutPage.social_proof.rating && (
                          <div>
                            <div className="text-3xl md:text-4xl font-bold text-primary flex items-center justify-center gap-1">
                              {aboutPage.social_proof.rating}
                              <Star className="size-6 fill-yellow-400 text-yellow-400" />
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {aboutPage.social_proof.review_count} Reviews
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {/* Founder Section */}
                {aboutPage.founder_name && (
                  <section className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-bold mb-8 flex items-center gap-3">
                      <Users className="size-8 text-primary" />
                      Meet the Founder
                    </h2>
                    <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                      {aboutPage.founder_image && (
                        <div className="shrink-0">
                          <Image
                            src={aboutPage.founder_image}
                            alt={aboutPage.founder_name}
                            width={200}
                            height={200}
                            className="rounded-full object-cover"
                          />
                        </div>
                      )}
                      <div>
                        <h3 className="text-2xl font-semibold mb-2">
                          {aboutPage.founder_name}
                        </h3>
                        {aboutPage.founded_year && (
                          <Badge variant="secondary" className="mb-4">
                            <Calendar className="size-3 mr-1" />
                            Founded in {aboutPage.founded_year}
                          </Badge>
                        )}
                        {aboutPage.founder_bio && (
                          <p className="text-muted-foreground">
                            {aboutPage.founder_bio}
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {/* Team Section */}
                {aboutPage.team && aboutPage.team.length > 0 && (
                  <section className="max-w-5xl mx-auto">
                    <h2 className="text-3xl font-bold mb-8 text-center">
                      Our Team
                    </h2>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {aboutPage.team.map((member) => (
                        <Card key={member.name} className="text-center">
                          <CardContent className="pt-6">
                            {member.image && (
                              <Image
                                src={member.image}
                                alt={member.name}
                                width={120}
                                height={120}
                                className="rounded-full mx-auto mb-4 object-cover"
                              />
                            )}
                            <h3 className="font-semibold text-lg">
                              {member.name}
                            </h3>
                            <p className="text-sm text-primary mb-2">
                              {member.role}
                            </p>
                            {member.bio && (
                              <p className="text-sm text-muted-foreground">
                                {member.bio}
                              </p>
                            )}
                            {member.social_links && (
                              <div className="flex justify-center gap-3 mt-4">
                                {member.social_links.linkedin && (
                                  <a
                                    href={member.social_links.linkedin}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-primary"
                                  >
                                    <ExternalLink className="size-4" />
                                  </a>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </section>
                )}

                {/* Milestones Timeline */}
                {aboutPage.milestones && aboutPage.milestones.length > 0 && (
                  <section className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-bold mb-8 flex items-center gap-3">
                      <Calendar className="size-8 text-primary" />
                      Our Journey
                    </h2>
                    <div className="space-y-6">
                      {aboutPage.milestones.map((milestone) => (
                        <div
                          key={`${milestone.year}-${milestone.title}`}
                          className="flex gap-4"
                        >
                          <div className="shrink-0 w-20 text-right">
                            <span className="font-bold text-primary">
                              {milestone.year}
                            </span>
                          </div>
                          <div className="relative pb-6 border-l-2 border-primary/20 pl-6">
                            <div className="absolute -left-2 top-1 size-4 rounded-full bg-primary" />
                            <h3 className="font-semibold">{milestone.title}</h3>
                            {milestone.description && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {milestone.description}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Awards Section */}
                {aboutPage.awards && aboutPage.awards.length > 0 && (
                  <section className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-bold mb-8 flex items-center gap-3">
                      <Trophy className="size-8 text-primary" />
                      Awards & Recognition
                    </h2>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {aboutPage.awards.map((award) => (
                        <Card
                          key={award.title}
                          className="bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800"
                        >
                          <CardContent className="pt-6 text-center">
                            <Award className="size-8 text-yellow-600 mx-auto mb-3" />
                            <h3 className="font-semibold">{award.title}</h3>
                            {award.issuer && (
                              <p className="text-sm text-muted-foreground">
                                {award.issuer}
                              </p>
                            )}
                            {award.year && (
                              <Badge variant="outline" className="mt-2">
                                {award.year}
                              </Badge>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </section>
                )}

                {/* Video Section */}
                {aboutPage.video_url &&
                  getVideoEmbedUrl(aboutPage.video_url) && (
                    <section className="max-w-4xl mx-auto">
                      <h2 className="text-3xl font-bold mb-8 flex items-center gap-3">
                        <Play className="size-8 text-primary" />
                        Watch Our Story
                      </h2>
                      <div className="aspect-video rounded-xl overflow-hidden bg-muted">
                        <iframe
                          src={getVideoEmbedUrl(aboutPage.video_url) as string}
                          title="About Us Video"
                          className="w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          loading="lazy"
                          sandbox={ABOUT_VIDEO_IFRAME_SANDBOX}
                        />
                      </div>
                    </section>
                  )}

                {/* Gallery */}
                {aboutPage.gallery && aboutPage.gallery.length > 0 && (
                  <section className="max-w-5xl mx-auto">
                    <h2 className="text-3xl font-bold mb-8 text-center">
                      Gallery
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {aboutPage.gallery.map((image) => (
                        <div
                          key={image}
                          className="aspect-square rounded-lg overflow-hidden"
                        >
                          <Image
                            src={image}
                            alt={`Gallery image`}
                            width={400}
                            height={400}
                            className="object-cover w-full h-full hover:scale-105 transition-transform"
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            ) : (
              /* Legacy Content Fallback */
              legacyContent && (
                <div className="max-w-4xl mx-auto">
                  <SafeHtml
                    html={legacyContent}
                    className="prose prose-lg dark:prose-invert max-w-none"
                  />
                </div>
              )
            )}
          </div>
          {children}
        </main>

        <StorefrontFooter />
      </div>
    </ContentPageProviders>
  );
}
