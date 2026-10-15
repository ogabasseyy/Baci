import { type NextRequest, NextResponse } from 'next/server';
import { type DomainPricing, getResalePrice } from '@/config/domain-pricing';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { type Go54LookupResponse, lookupDomain } from '@/lib/go54';

/**
 * POST /api/domains/check-availability
 * Check if domain is available for registration using Go54's whoislookup.php
 */
export async function POST(request: Request) {
  try {
    // CSRF protection
    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request as NextRequest);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    // Authenticate request (supports mobile Bearer token + web cookies)
    const { user, error: authError } = await authenticateApiRequest(request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchTerm } = await request.json();

    if (!searchTerm) {
      return NextResponse.json(
        { error: 'Search term is required' },
        { status: 400 }
      );
    }

    // Clean and validate search term
    const cleanSearchTerm = searchTerm.trim().toLowerCase();

    // If user typed just a TLD like ".com", show helpful error
    if (cleanSearchTerm.startsWith('.') && !cleanSearchTerm.includes('.', 1)) {
      return NextResponse.json(
        {
          error:
            'Please enter a domain name (e.g., "mystore" or "mystore.com")',
        },
        { status: 400 }
      );
    }

    // Extract just the domain name part if full domain was entered
    if (cleanSearchTerm.includes('.')) {
      // User entered full domain like "mystore.com" - use it directly
      const domainNamePart = cleanSearchTerm.split('.')[0];
      // Validate the domain name part
      const domainRegex = /^[a-z0-9-]+$/i;
      if (!domainRegex.test(domainNamePart)) {
        return NextResponse.json(
          {
            error: 'Domain name can only contain letters, numbers, and hyphens',
          },
          { status: 400 }
        );
      }
    } else {
      // User entered just a name like "mystore" - validate it
      const searchTermRegex = /^[a-z0-9-]+$/i;
      if (!searchTermRegex.test(cleanSearchTerm)) {
        return NextResponse.json(
          {
            error: 'Search term can only contain letters, numbers, and hyphens',
          },
          { status: 400 }
        );
      }
    }

    // Primary domain to check (default to .com)
    const primaryDomain = cleanSearchTerm.includes('.')
      ? cleanSearchTerm
      : `${cleanSearchTerm}.com`;

    // Query Go54's whoislookup endpoint (primary)
    const lookupResult = await lookupDomain(primaryDomain);

    if (!lookupResult) {
      // Try Namecheap fallback if configured
      const { checkNamecheapAvailability, isNamecheapConfigured } =
        await import('@/lib/namecheap');

      if (isNamecheapConfigured()) {
        const namecheapResults = await checkNamecheapAvailability([
          primaryDomain,
        ]);
        if (namecheapResults.length > 0) {
          return NextResponse.json({
            searchTerm,
            results: namecheapResults.map((r) => ({
              domain: r.domain,
              tld: `.${r.domain.split('.').slice(1).join('.')}`,
              available: r.available,
              price: r.premiumPrice || 15000,
              renewalPrice: r.premiumPrice || 24000,
              category: r.isPremium ? 'premium' : 'global',
              popular: true,
            })),
            warning: 'Using fallback provider.',
          });
        }
      }

      return NextResponse.json({
        searchTerm,
        results: [],
        warning: 'Domain lookup service unavailable. Please try again later.',
      });
    }

    // Build results from primary domain + suggestions
    const results = await buildDomainResults(searchTerm, lookupResult);

    return NextResponse.json({
      searchTerm,
      results,
    });
  } catch (error) {
    console.error('[DomainSearch] Error checking domain availability:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Build domain results from Go54 lookup response
 */
async function buildDomainResults(
  _searchTerm: string,
  primaryResult: Go54LookupResponse
) {
  const results: Array<{
    domain: string;
    tld: string;
    available: boolean;
    price: number;
    costPrice: number;
    renewalPrice: number;
    category: DomainPricing['category'];
    popular?: boolean;
    recommended?: boolean;
    premium?: boolean;
  }> = [];

  // Helper to determine category from TLD
  const getCategoryFromTld = (tld: string): DomainPricing['category'] => {
    const nigerianTlds = [
      '.ng',
      '.com.ng',
      '.org.ng',
      '.net.ng',
      '.name.ng',
      '.edu.ng',
    ];
    const premiumTlds = ['.store', '.shop', '.app', '.io', '.ai', '.dev'];

    if (nigerianTlds.includes(tld)) return 'nigerian';
    if (premiumTlds.includes(tld)) return 'premium';
    return 'global';
  };

  // Add primary domain result
  const primaryTld = `.${primaryResult.domain.split('.').slice(1).join('.')}`;
  const primaryCategory = getCategoryFromTld(primaryTld);
  const registerCost = Number.parseFloat(
    primaryResult.pricing.domainregister[0]?.price || '0'
  );
  const renewCost = Number.parseFloat(
    primaryResult.pricing.domainrenew[0]?.price || '0'
  );

  results.push({
    domain: primaryResult.domain,
    tld: primaryTld,
    available: primaryResult.status === 'available',
    costPrice: registerCost,
    price: getResalePrice(registerCost, primaryCategory),
    renewalPrice: getResalePrice(renewCost, primaryCategory),
    category: primaryCategory,
    popular: primaryTld === '.com' || primaryTld === '.com.ng',
    recommended: primaryResult.status === 'available' && primaryTld === '.com',
    premium: primaryResult.premium,
  });

  // Lookup suggestions - limit to 3 to avoid rate limiting
  const suggestionsToCheck = primaryResult.suggestions.slice(0, 3);

  // For suggestions, we'll wait a tiny bit to avoid being flagged as a bot
  await new Promise((resolve) => setTimeout(resolve, 300));

  const suggestionResults = await Promise.all(
    suggestionsToCheck.map(async (suggestion) => {
      try {
        return await lookupDomain(suggestion);
      } catch (error) {
        // Audit-noise: a crafted value can only garble this server log line. Dismissed in code-scanning (false-positive).
        // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
        console.error(`Error looking up suggestion ${suggestion}:`, error);
        return null;
      }
    })
  );

  for (const suggestion of suggestionResults) {
    if (!suggestion) continue;

    const tld = `.${suggestion.domain.split('.').slice(1).join('.')}`;
    const category = getCategoryFromTld(tld);
    const regCost = Number.parseFloat(
      suggestion.pricing.domainregister[0]?.price || '0'
    );
    const renCost = Number.parseFloat(
      suggestion.pricing.domainrenew[0]?.price || '0'
    );

    // Determine popular TLDs
    const popularTlds = ['.com', '.com.ng', '.ng', '.name.ng', '.org', '.net'];

    results.push({
      domain: suggestion.domain,
      tld,
      available: suggestion.status === 'available',
      costPrice: regCost,
      price: getResalePrice(regCost, category),
      renewalPrice: getResalePrice(renCost, category),
      category,
      popular: popularTlds.includes(tld),
      recommended: suggestion.status === 'available' && tld === '.com.ng',
      premium: suggestion.premium,
    });
  }

  // Sort: available first, then by popularity, then by price
  results.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.popular !== b.popular) return a.popular ? -1 : 1;
    return a.price - b.price;
  });

  return results;
}
