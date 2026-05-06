import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BOT_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence; contact@tracegraph.io)';

export interface Founder {
  name: string;
  title: string | null;
  linkedin: string | null;
  background: string | null;
}

export interface FundingRound {
  type: string | null;
  amount: string | null;
  date: string | null;
  investors: string[];
  source: string;
}

export interface PersonProfile {
  name: string;
  title: string | null;
  linkedin: string | null;
  background: string | null;
  hnPosts: Array<{ title: string; points: number; date: string }>;
  newsHits: Array<{ title: string; source: string; date: string }>;
  githubUsername: string | null;
  githubActivity: string | null;
  priorCompanies: string[];
}

export interface TechStack {
  hosting: string[];
  frontend: string[];
  backend: string[];
  analytics: string[];
  marketing: string[];
  payments: string[];
  raw: string[];
}

export interface JobPosting {
  title: string;
  department: string;
  location: string | null;
}

export interface DomainResearchResult {
  domain: string;
  companyName: string | null;
  description: string | null;
  tagline: string | null;
  founders: PersonProfile[];
  teamMembers: string[];
  location: string | null;
  industry: string | null;
  employeeCount: string | null;
  linkedinEmployeeCount: string | null;
  foundedYear: number | null;
  fundingRounds: FundingRound[];
  totalFundingAmount: string | null;
  investors: string[];
  email: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  githubUrl: string | null;
  crunchbaseUrl: string | null;
  github: {
    orgName: string | null;
    url: string;
    repos: number;
    stars: number;
    contributors: number;
    topLanguages: string[];
    lastActivity: string | null;
    topRepos: Array<{ name: string; stars: number; description: string | null }>;
  } | null;
  techStack: TechStack | null;
  jobPostings: JobPosting[];
  openRoleCount: number;
  productHunt: {
    found: boolean;
    name: string | null;
    upvotes: number;
    reviews: number;
    launchDate: string | null;
    makers: string[];
  } | null;
  news: Array<{ title: string; source: string; date: string; url: string }>;
  hnMentions: Array<{ title: string; points: number; comments: number; url: string; date: string }>;
  whois: { registrar: string | null; createdDate: string | null; country: string | null };
  wayback: { firstSeen: string | null; ageYears: number | null; totalSnapshots: number };
  ddQuestions: string[];
  sources: string[];
}

@Injectable()
export class DomainResearchService {
  private readonly logger = new Logger(DomainResearchService.name);

  /** Entry point: company name → discover domain → research everything */
  async researchByName(companyName: string): Promise<DomainResearchResult> {
    this.logger.log(`[Research] Starting by name: ${companyName}`);
    const domain = await this.discoverDomain(companyName);
    const result = await this.research(domain || companyName, companyName);
    if (!result.companyName || result.companyName === domain) {
      result.companyName = companyName;
    }
    return result;
  }

  /** Entry point: domain → research everything */
  async research(input: string, hintName?: string): Promise<DomainResearchResult> {
    const domain = this.normalizeDomain(input);
    this.logger.log(`[Research] Domain: ${domain}`);

    const result: DomainResearchResult = {
      domain,
      companyName: hintName || null,
      description: null,
      tagline: null,
      founders: [],
      teamMembers: [],
      location: null,
      industry: null,
      employeeCount: null,
      linkedinEmployeeCount: null,
      foundedYear: null,
      fundingRounds: [],
      totalFundingAmount: null,
      investors: [],
      email: null,
      linkedinUrl: null,
      twitterUrl: null,
      githubUrl: null,
      crunchbaseUrl: null,
      github: null,
      techStack: null,
      jobPostings: [],
      openRoleCount: 0,
      productHunt: null,
      news: [],
      hnMentions: [],
      whois: { registrar: null, createdDate: null, country: null },
      wayback: { firstSeen: null, ageYears: null, totalSnapshots: 0 },
      ddQuestions: [],
      sources: [],
    };

    // Run all sources in parallel for speed
    const companySlug = domain.replace(/\.(io|com|co|ai|app|net|org|in)$/, '').replace(/[^a-z0-9]/gi, '');
    const searchName = hintName || companySlug;

    const [websiteData, crunchbaseData, githubData, hnData, newsData, whoisData, waybackData, techStackData, jobData, phData] = await Promise.all([
      this.scrapeWebsite(domain).catch(() => null),
      this.scrapeCrunchbase(companySlug, searchName).catch(() => null),
      this.searchGitHub(companySlug, searchName).catch(() => null),
      this.searchHackerNews(searchName).catch(() => null),
      this.searchGoogleNews(searchName).catch(() => null),
      this.lookupWhois(domain).catch(() => null),
      this.checkWayback(domain).catch(() => null),
      this.detectTechStack(domain).catch(() => null),
      this.scrapeJobPostings(domain).catch(() => null),
      this.searchProductHunt(searchName).catch(() => null),
    ]);

    // ── WHOIS ──────────────────────────────────────────────────────────────
    if (whoisData) {
      result.whois = whoisData;
      result.sources.push('WHOIS/RDAP');
    }

    // ── Wayback ─────────────────────────────────────────────────────────────
    if (waybackData) {
      result.wayback = waybackData;
      result.sources.push('Wayback Machine');
    }

    // ── Website ─────────────────────────────────────────────────────────────
    if (websiteData) {
      result.email = result.email || websiteData.email;
      result.linkedinUrl = result.linkedinUrl || websiteData.linkedinUrl;
      result.twitterUrl = result.twitterUrl || websiteData.twitterUrl;
      result.githubUrl = result.githubUrl || websiteData.githubUrl;
      result.sources.push('Website');

      // LLM extraction from website content
      if (websiteData.text) {
        const extracted = await this.extractWithLlm(domain, searchName, websiteData.text);
        if (extracted) {
          result.companyName = result.companyName || extracted.companyName;
          result.description = extracted.description;
          result.tagline = extracted.tagline;
          result.location = result.location || extracted.location;
          result.industry = result.industry || extracted.industry;
          result.foundedYear = result.foundedYear || extracted.foundedYear;
          result.employeeCount = result.employeeCount || extracted.employeeCount;

          // Merge founders from website extraction
          for (const f of (extracted.founders || [])) {
            if (!result.founders.find(x => x.name === f.name)) {
              result.founders.push(f);
            }
          }
          result.teamMembers = [...new Set([...result.teamMembers, ...(extracted.teamMembers || [])])];

          // Funding from website text
          for (const round of (extracted.fundingRounds || [])) {
            result.fundingRounds.push({ ...round, source: 'website' });
          }
          result.sources.push('LLM extraction');
        }
      }
    }

    // ── Crunchbase ──────────────────────────────────────────────────────────
    if (crunchbaseData) {
      this.logger.log(`[Research] Crunchbase: found ${crunchbaseData.founders?.length || 0} founders, ${crunchbaseData.fundingRounds?.length || 0} rounds`);
      result.crunchbaseUrl = crunchbaseData.url;
      result.companyName = result.companyName || crunchbaseData.name;
      result.description = result.description || crunchbaseData.description;
      result.location = result.location || crunchbaseData.location;
      result.foundedYear = result.foundedYear || crunchbaseData.foundedYear;
      result.employeeCount = result.employeeCount || crunchbaseData.employeeCount;
      result.industry = result.industry || crunchbaseData.industry;
      result.totalFundingAmount = crunchbaseData.totalFunding;

      // Crunchbase founders are the most reliable — merge carefully
      for (const f of (crunchbaseData.founders || [])) {
        if (!result.founders.find(x => x.name === f.name)) {
          result.founders.push(f);
        }
      }
      for (const round of (crunchbaseData.fundingRounds || [])) {
        result.fundingRounds.push({ ...round, source: 'crunchbase' });
        for (const inv of (round.investors || [])) {
          if (!result.investors.includes(inv)) result.investors.push(inv);
        }
      }
      result.sources.push('Crunchbase');
    }

    // ── GitHub ──────────────────────────────────────────────────────────────
    if (githubData) {
      result.github = githubData;
      result.githubUrl = result.githubUrl || githubData.url;
      result.sources.push('GitHub');
    }

    // ── HackerNews ──────────────────────────────────────────────────────────
    if (hnData && hnData.length > 0) {
      result.hnMentions = hnData.slice(0, 5);
      result.sources.push('HackerNews');
    }

    // ── News ────────────────────────────────────────────────────────────────
    if (newsData && newsData.length > 0) {
      result.news = newsData.slice(0, 8);
      // Extract investors from news headlines
      for (const article of newsData) {
        const investorMatches = this.extractInvestorsFromText(article.title);
        for (const inv of investorMatches) {
          if (!result.investors.includes(inv)) result.investors.push(inv);
        }
        // Extract funding rounds from news
        const fundingMatch = article.title.match(/\$[\d\.]+[MBK]|\d+\s*(?:million|billion)/i);
        if (fundingMatch) {
          result.fundingRounds.push({
            type: null,
            amount: fundingMatch[0],
            date: article.date,
            investors: [],
            source: 'news: ' + article.source,
          });
        }
      }
      result.sources.push('News');
    }

    // ── Tech Stack ──────────────────────────────────────────────────────────
    if (techStackData) {
      result.techStack = techStackData;
      result.sources.push('Tech stack detection');
    }

    // ── Job Postings ────────────────────────────────────────────────────────
    if (jobData && jobData.length > 0) {
      result.jobPostings = jobData;
      result.openRoleCount = jobData.length;
      result.sources.push(`Job postings (${jobData.length} open roles)`);
    }

    // ── ProductHunt ─────────────────────────────────────────────────────────
    if (phData) {
      result.productHunt = phData;
      if (phData.found) result.sources.push('ProductHunt');
    }

    // ── Person enrichment — run on each founder found ───────────────────────
    if (result.founders.length > 0) {
      const enriched = await Promise.all(
        result.founders.slice(0, 5).map((f) =>
          this.enrichPerson(f.name, f.title, f.linkedin).then((extra) => ({ ...f, ...extra })).catch(() => f),
        ),
      );
      result.founders = enriched;
      if (enriched.some((f) => f.hnPosts?.length > 0 || f.newsHits?.length > 0)) {
        result.sources.push('Founder enrichment');
      }
    }

    // ── LinkedIn headcount ──────────────────────────────────────────────────
    if (result.linkedinUrl) {
      const liData = await this.scrapeLinkedInCompany(result.linkedinUrl).catch(() => null);
      if (liData) {
        result.linkedinEmployeeCount = liData.employeeCount;
        result.employeeCount = result.employeeCount || liData.employeeCount;
        result.description = result.description || liData.description;
        result.foundedYear = result.foundedYear || liData.foundedYear;
        result.sources.push('LinkedIn');
      }
    }

    // ── Generate DD questions for gaps ──────────────────────────────────────
    result.ddQuestions = this.generateDDQuestions(result);

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SOURCE: Crunchbase public page scraper
  // ──────────────────────────────────────────────────────────────────────────
  private async scrapeCrunchbase(slug: string, name: string): Promise<any | null> {
    const urlsToTry = [
      `https://www.crunchbase.com/organization/${slug}`,
      `https://www.crunchbase.com/organization/${name.toLowerCase().replace(/\s+/g, '-')}`,
      `https://www.crunchbase.com/organization/${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    ];

    for (const url of urlsToTry) {
      try {
        const res = await axios.get(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 12000,
          maxRedirects: 3,
        });

        if (res.status !== 200 || !res.data) continue;
        const html: string = res.data;

        // Crunchbase embeds JSON-LD structured data
        const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        let structuredData: any = null;
        if (jsonLdMatch) {
          try { structuredData = JSON.parse(jsonLdMatch[1]); } catch {}
        }

        // Also try to find the __NEXT_DATA__ JSON blob
        const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        let nextData: any = null;
        if (nextDataMatch) {
          try { nextData = JSON.parse(nextDataMatch[1]); } catch {}
        }

        // Extract via text parsing as fallback
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

        // Extract key fields
        const result: any = {
          url,
          name: null,
          description: null,
          location: null,
          foundedYear: null,
          employeeCount: null,
          industry: null,
          totalFunding: null,
          founders: [],
          fundingRounds: [],
        };

        // From JSON-LD
        if (structuredData) {
          result.name = structuredData.name || null;
          result.description = structuredData.description?.slice(0, 500) || null;
          result.location = structuredData.location?.address?.addressLocality || null;
          result.foundedYear = structuredData.foundingDate ? parseInt(structuredData.foundingDate) : null;
          result.employeeCount = structuredData.numberOfEmployees?.value || null;
          result.industry = structuredData.knowsAbout?.[0] || null;
        }

        // From __NEXT_DATA__ (Crunchbase's main data blob)
        if (nextData) {
          try {
            const pageData = nextData?.props?.pageProps?.initialData?.data?.organization || {};
            result.name = result.name || pageData.name;
            result.description = result.description || pageData.short_description?.slice(0, 500);
            result.location = result.location || `${pageData.city}, ${pageData.country_code}`.replace(/^,\s*|,\s*$/, '').replace(/,\s*undefined/, '');
            result.foundedYear = result.foundedYear || pageData.founded_on?.value?.slice(0, 4);
            result.totalFunding = pageData.funding_total?.value_usd
              ? `$${(pageData.funding_total.value_usd / 1_000_000).toFixed(1)}M`
              : null;

            // Founders
            const people = pageData.founder_identifiers || [];
            result.founders = people.map((p: any) => ({
              name: p.value || p.name,
              title: 'Founder',
              linkedin: null,
              background: null,
            }));

            // Funding rounds
            const rounds = pageData.funding_rounds || [];
            result.fundingRounds = rounds.map((r: any) => ({
              type: r.investment_type || r.series,
              amount: r.money_raised?.value_usd ? `$${(r.money_raised.value_usd / 1_000_000).toFixed(1)}M` : null,
              date: r.announced_on?.value,
              investors: (r.lead_investor_identifiers || []).map((i: any) => i.value || i.name),
            }));
          } catch { /* nextData structure varies */ }
        }

        // Text-based fallbacks
        if (!result.name) {
          const nameMatch = text.match(/Organization Name[:\s]+([A-Za-z0-9\s\-\.]+?)(?:\s{2,}|Headquarters|Founded)/);
          if (nameMatch) result.name = nameMatch[1].trim();
        }

        const foundedMatch = text.match(/Founded[:\s]+(\d{4})/i);
        if (foundedMatch && !result.foundedYear) result.foundedYear = parseInt(foundedMatch[1]);

        const employeeMatch = text.match(/(\d+[-–]\d+|\d+\+?)\s*(?:employees|people)/i);
        if (employeeMatch && !result.employeeCount) result.employeeCount = employeeMatch[1];

        const fundingMatch = text.match(/Total Funding Amount[:\s]+\$?([\d\.]+[MBK]?)/i);
        if (fundingMatch && !result.totalFunding) result.totalFunding = `$${fundingMatch[1]}`;

        if (result.name || result.description || result.founders.length > 0 || result.fundingRounds.length > 0) {
          return result;
        }
      } catch (e: any) {
        this.logger.warn(`[Crunchbase] Failed for ${url}: ${e?.message?.slice(0, 80)}`);
      }
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SOURCE: GitHub API (free, no key needed for basic searches)
  // ──────────────────────────────────────────────────────────────────────────
  private async searchGitHub(slug: string, name: string): Promise<any | null> {
    // Search for org by name
    const searchTerms = [slug, name.toLowerCase().replace(/\s+/g, '-'), name.toLowerCase().replace(/\s+/g, '')];

    for (const term of searchTerms) {
      try {
        // Try direct org lookup first
        const orgRes = await axios.get(`https://api.github.com/orgs/${term}`, {
          headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': BOT_AGENT },
          timeout: 8000,
        });

        if (orgRes.status === 200 && orgRes.data) {
          const org = orgRes.data;

          // Get top repos
          const reposRes = await axios.get(`https://api.github.com/orgs/${term}/repos`, {
            params: { sort: 'stars', per_page: 10 },
            headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': BOT_AGENT },
            timeout: 8000,
          }).catch(() => ({ data: [] }));

          const repos = reposRes.data || [];
          const languages = [...new Set(repos.filter((r: any) => r.language).map((r: any) => r.language))].slice(0, 5);
          const totalStars = repos.reduce((s: number, r: any) => s + (r.stargazers_count || 0), 0);

          // Get members (contributors)
          const membersRes = await axios.get(`https://api.github.com/orgs/${term}/members`, {
            params: { per_page: 20 },
            headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': BOT_AGENT },
            timeout: 8000,
          }).catch(() => ({ data: [] }));

          return {
            orgName: org.login,
            url: org.html_url,
            description: org.description,
            location: org.location,
            publicRepos: org.public_repos,
            repos: repos.length,
            stars: totalStars,
            contributors: (membersRes.data || []).length,
            topLanguages: languages,
            lastActivity: repos[0]?.updated_at || null,
            topRepos: repos.slice(0, 3).map((r: any) => ({ name: r.name, stars: r.stargazers_count, description: r.description })),
          };
        }
      } catch { /* try next */ }
    }

    // Fall back to search API
    try {
      const searchRes = await axios.get('https://api.github.com/search/users', {
        params: { q: `${name} type:org`, per_page: 3 },
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': BOT_AGENT },
        timeout: 8000,
      });

      const items = searchRes.data?.items || [];
      if (items.length > 0) {
        const org = items[0];
        return {
          orgName: org.login,
          url: org.html_url,
          repos: 0,
          stars: 0,
          contributors: 0,
          topLanguages: [],
          lastActivity: null,
        };
      }
    } catch { /* non-critical */ }

    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SOURCE: HackerNews via Algolia API (free, no key)
  // ──────────────────────────────────────────────────────────────────────────
  private async searchHackerNews(name: string): Promise<any[]> {
    const res = await axios.get('https://hn.algolia.com/api/v1/search', {
      params: { query: name, tags: 'story', hitsPerPage: 10 },
      headers: { 'User-Agent': BOT_AGENT },
      timeout: 8000,
    });

    return (res.data?.hits || [])
      .filter((h: any) => h.title?.toLowerCase().includes(name.toLowerCase()))
      .map((h: any) => ({
        title: h.title,
        points: h.points || 0,
        comments: h.num_comments || 0,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        date: h.created_at?.slice(0, 10),
      }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SOURCE: Google News RSS (free, no key)
  // ──────────────────────────────────────────────────────────────────────────
  private async searchGoogleNews(name: string): Promise<any[]> {
    try {
      const res = await axios.get(`https://news.google.com/rss/search`, {
        params: { q: `${name} company`, hl: 'en-US', gl: 'US', ceid: 'US:en' },
        headers: { 'User-Agent': BOT_AGENT, Accept: 'application/rss+xml,application/xml' },
        timeout: 10000,
      });

      const xml: string = res.data || '';
      const items: any[] = [];

      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
      for (const match of itemMatches) {
        const item = match[1];
        const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        const source = item.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || '';
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
        const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';

        if (title && title.toLowerCase().includes(name.toLowerCase())) {
          items.push({
            title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
            source,
            date: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : '',
            url: link,
          });
        }
        if (items.length >= 8) break;
      }
      return items;
    } catch { return []; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SOURCE: Website scraper — targets team/about/investor pages specifically
  // ──────────────────────────────────────────────────────────────────────────
  private async scrapeWebsite(domain: string): Promise<{ text: string; email: string | null; linkedinUrl: string | null; twitterUrl: string | null; githubUrl: string | null } | null> {
    const pages = [
      `https://${domain}/about`,
      `https://${domain}/about-us`,
      `https://${domain}/team`,
      `https://${domain}/our-team`,
      `https://${domain}/leadership`,
      `https://${domain}/company`,
      `https://${domain}/investors`,
      `https://${domain}`,
    ];

    let combinedText = '';
    let email: string | null = null;
    let linkedinUrl: string | null = null;
    let twitterUrl: string | null = null;
    let githubUrl: string | null = null;

    for (const url of pages) {
      try {
        const res = await axios.get(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
          timeout: 8000,
          maxRedirects: 3,
        });
        if (res.status !== 200) continue;

        const html: string = res.data || '';
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        combinedText += `\n\n[${url}]\n${text.slice(0, 3000)}`;

        if (!email) {
          const m = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
          if (m && !m[0].includes('@example') && !m[0].includes('@sentry') && !m[0].includes('@test')) email = m[0];
        }
        if (!linkedinUrl) {
          const m = html.match(/https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9\-_]+/);
          if (m) linkedinUrl = m[0];
        }
        if (!twitterUrl) {
          const m = html.match(/https?:\/\/(www\.)?(twitter|x)\.com\/[a-zA-Z0-9_]+/);
          if (m) twitterUrl = m[0];
        }
        if (!githubUrl) {
          const m = html.match(/https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9\-_]+/);
          if (m) githubUrl = m[0];
        }
        if (combinedText.length > 10000) break;
      } catch { /* try next page */ }
    }

    if (!combinedText.trim()) return null;
    return { text: combinedText.slice(0, 10000), email, linkedinUrl, twitterUrl, githubUrl };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LLM extraction — much more targeted prompt
  // ──────────────────────────────────────────────────────────────────────────
  private async extractWithLlm(domain: string, companyName: string, text: string): Promise<any | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
    if (!apiKey || !text) return null;

    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content: `You are extracting structured company intelligence from website content for M&A due diligence.
Extract ONLY what is explicitly stated. Return JSON with these fields:

{
  "companyName": "official company name",
  "tagline": "short company tagline/slogan",
  "description": "2-3 sentence description of what the company does",
  "location": "city, country",
  "industry": "industry/sector",
  "foundedYear": 2019,
  "employeeCount": "50-200",
  "founders": [
    {"name": "Full Name", "title": "CEO & Co-Founder", "linkedin": "url or null", "background": "1 sentence bio if available"}
  ],
  "teamMembers": ["Name - Title", "Name - Title"],
  "fundingRounds": [
    {"type": "Series A", "amount": "$5M", "date": "2022-03", "investors": ["Sequoia", "Y Combinator"]}
  ],
  "investors": ["investor name"],
  "customers": ["notable customer names if mentioned"],
  "keyProducts": ["product name 1", "product name 2"]
}

Rules:
- Return null for any field you cannot find with confidence
- ONLY extract actual founder names — not marketing personas or customer names
- ONLY extract investors explicitly named as investors/backers
- For teamMembers, only include people with specific names and titles shown
- Funding amounts must be explicitly stated (e.g. "$5M", "5 million") — do not guess`,
            },
            {
              role: 'user',
              content: `Company: ${companyName} (${domain})\n\nWebsite content:\n${text.slice(0, 6000)}`,
            },
          ],
          temperature: 0.1,
          max_tokens: 800,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://tracegraph.local',
            'X-Title': 'TraceGraph Intelligence',
          },
          timeout: 25000,
        },
      );

      const raw = res.data?.choices?.[0]?.message?.content || '';
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      return JSON.parse(cleaned);
    } catch (e: any) {
      this.logger.warn(`[LLM] Extraction failed: ${e?.message?.slice(0, 100)}`);
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WHOIS via RDAP
  // ──────────────────────────────────────────────────────────────────────────
  private async lookupWhois(domain: string): Promise<any | null> {
    try {
      const res = await axios.get(`https://rdap.org/domain/${domain}`, {
        headers: { Accept: 'application/json' },
        timeout: 8000,
      });
      const d = res.data;
      const getEvent = (type: string) => d.events?.find((e: any) => e.eventAction === type)?.eventDate || null;
      const registrar = d.entities?.find((e: any) => e.roles?.includes('registrar'));
      const registrant = d.entities?.find((e: any) => e.roles?.includes('registrant'));
      const country = registrant?.vcardArray?.[1]?.find((v: any) => v[0] === 'adr')?.[1]?.['country-name'] || null;
      const registrarName = registrar?.vcardArray?.[1]?.find((v: any) => v[0] === 'fn')?.[3] || registrar?.handle || null;
      return { registrar: registrarName, createdDate: getEvent('registration'), country };
    } catch { return null; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Wayback Machine
  // ──────────────────────────────────────────────────────────────────────────
  private async checkWayback(domain: string): Promise<any | null> {
    try {
      const res = await axios.get('https://web.archive.org/cdx/search/cdx', {
        params: { url: domain, output: 'json', fl: 'timestamp', limit: 2, filter: 'statuscode:200' },
        headers: { 'User-Agent': BOT_AGENT },
        timeout: 10000,
      });
      const rows: string[][] = res.data || [];
      if (rows.length <= 1) return { firstSeen: null, ageYears: null, totalSnapshots: 0 };
      const ts = rows[1]?.[0];
      if (!ts) return null;
      const firstDate = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
      const ageYears = Math.floor((Date.now() - new Date(firstDate).getTime()) / (365.25 * 24 * 3600 * 1000));
      return { firstSeen: firstDate, ageYears, totalSnapshots: rows.length - 1 };
    } catch { return null; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────
  private normalizeDomain(input: string): string {
    try {
      if (!input.startsWith('http')) input = 'https://' + input;
      return new URL(input).hostname.replace(/^www\./, '');
    } catch {
      return input.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }

  /** Try to find company's website from its name */
  async discoverDomain(companyName: string): Promise<string | null> {
    // DuckDuckGo instant answer
    try {
      const res = await axios.get('https://api.duckduckgo.com/', {
        params: { q: `${companyName} company official website`, format: 'json', no_redirect: 1, no_html: 1 },
        headers: { 'User-Agent': BOT_AGENT },
        timeout: 8000,
      });
      const data = res.data;
      if (data?.AbstractURL) return this.normalizeDomain(data.AbstractURL);
      for (const topic of data?.RelatedTopics || []) {
        const url = topic?.FirstURL || '';
        if (url.includes('http') && !url.includes('duckduckgo')) return this.normalizeDomain(url);
      }
    } catch { /* fallback */ }

    // Guess common patterns
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const tld of ['.io', '.com', '.ai', '.co', '.app']) {
      try {
        const domain = slug + tld;
        const res = await axios.head(`https://${domain}`, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 5000,
          maxRedirects: 3,
        });
        if (res.status < 400) return domain;
      } catch { /* try next */ }
    }
    return null;
  }

  private extractInvestorsFromText(text: string): string[] {
    const investors: string[] = [];
    const patterns = [
      /led by ([A-Z][a-zA-Z\s]+(?:Ventures|Capital|Partners|Fund|Investments|VC))/g,
      /backed by ([A-Z][a-zA-Z\s]+(?:Ventures|Capital|Partners|Fund|Investments|VC))/g,
      /from ([A-Z][a-zA-Z\s]+(?:Ventures|Capital|Partners|Fund|Investments|VC))/g,
    ];
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const m of matches) investors.push(m[1].trim());
    }
    return [...new Set(investors)];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Tech Stack Detection — from HTTP headers + HTML script/link analysis
  // ──────────────────────────────────────────────────────────────────────────
  private async detectTechStack(domain: string): Promise<TechStack | null> {
    try {
      const res = await axios.get(`https://${domain}`, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 10000,
        maxRedirects: 3,
      });

      const html: string = res.data || '';
      const headers = res.headers || {};
      const stack: TechStack = { hosting: [], frontend: [], backend: [], analytics: [], marketing: [], payments: [], raw: [] };

      // Headers
      const server = headers['server'] || '';
      const via = headers['via'] || '';
      const xPowered = headers['x-powered-by'] || '';
      const cfRay = headers['cf-ray'] || '';

      if (cfRay || via.includes('cloudflare')) stack.hosting.push('Cloudflare');
      if (server.includes('nginx')) stack.hosting.push('Nginx');
      if (server.includes('apache')) stack.hosting.push('Apache');
      if (server.includes('vercel') || headers['x-vercel-id']) stack.hosting.push('Vercel');
      if (headers['x-amz-cf-id'] || headers['x-amz-request-id']) stack.hosting.push('AWS');
      if (headers['x-goog-request-id']) stack.hosting.push('Google Cloud');
      if (xPowered.includes('Express')) stack.backend.push('Express.js');
      if (xPowered.includes('PHP')) stack.backend.push('PHP');
      if (xPowered.includes('ASP.NET')) stack.backend.push('ASP.NET');

      // HTML script/link analysis
      const scriptMap: Record<string, string> = {
        'react': 'React', 'react-dom': 'React', 'vue': 'Vue.js', 'angular': 'Angular',
        'next': 'Next.js', 'nuxt': 'Nuxt.js', 'gatsby': 'Gatsby', 'svelte': 'Svelte',
        'jquery': 'jQuery', 'bootstrap': 'Bootstrap', 'tailwind': 'Tailwind CSS',
        'segment': 'Segment', 'amplitude': 'Amplitude', 'mixpanel': 'Mixpanel',
        'gtag': 'Google Analytics', 'analytics': 'Analytics', 'heap': 'Heap',
        'hubspot': 'HubSpot', 'intercom': 'Intercom', 'zendesk': 'Zendesk',
        'hotjar': 'Hotjar', 'fullstory': 'FullStory', 'clarity': 'Microsoft Clarity',
        'stripe': 'Stripe', 'paypal': 'PayPal', 'braintree': 'Braintree',
        'sentry': 'Sentry', 'datadog': 'Datadog', 'logrocket': 'LogRocket',
        'vercel': 'Vercel', 'netlify': 'Netlify', 'firebase': 'Firebase',
        'supabase': 'Supabase', 'sanity': 'Sanity CMS', 'contentful': 'Contentful',
        'wordpress': 'WordPress', 'shopify': 'Shopify', 'webflow': 'Webflow',
        'auth0': 'Auth0', 'clerk': 'Clerk', 'okta': 'Okta',
        'openai': 'OpenAI API', 'anthropic': 'Anthropic API',
      };

      const htmlLower = html.toLowerCase();
      for (const [key, label] of Object.entries(scriptMap)) {
        if (htmlLower.includes(key)) {
          if (['Segment', 'Amplitude', 'Mixpanel', 'Google Analytics', 'Heap', 'Hotjar', 'FullStory', 'Microsoft Clarity'].includes(label)) {
            if (!stack.analytics.includes(label)) stack.analytics.push(label);
          } else if (['HubSpot', 'Intercom', 'Zendesk'].includes(label)) {
            if (!stack.marketing.includes(label)) stack.marketing.push(label);
          } else if (['Stripe', 'PayPal', 'Braintree'].includes(label)) {
            if (!stack.payments.includes(label)) stack.payments.push(label);
          } else if (['React', 'Vue.js', 'Angular', 'Next.js', 'Nuxt.js', 'Gatsby', 'Svelte', 'jQuery', 'Bootstrap', 'Tailwind CSS'].includes(label)) {
            if (!stack.frontend.includes(label)) stack.frontend.push(label);
          } else {
            if (!stack.raw.includes(label)) stack.raw.push(label);
          }
        }
      }

      // Only return if we found something
      const hasData = Object.values(stack).some((arr) => arr.length > 0);
      return hasData ? stack : null;
    } catch { return null; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Job Postings — scrape careers page for open roles
  // ──────────────────────────────────────────────────────────────────────────
  private async scrapeJobPostings(domain: string): Promise<JobPosting[]> {
    const careerPages = ['/careers', '/jobs', '/join', '/join-us', '/work-with-us', '/hiring', '/open-roles', '/positions'];
    const jobs: JobPosting[] = [];

    for (const path of careerPages) {
      try {
        const res = await axios.get(`https://${domain}${path}`, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 8000,
          maxRedirects: 3,
        });
        if (res.status !== 200) continue;

        const text = (res.data || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

        // Common job title patterns
        const deptPatterns: Record<string, RegExp> = {
          'Engineering': /(?:senior |junior |staff |principal |lead )?(?:software|backend|frontend|fullstack|full[\s-]stack|platform|infrastructure|devops|security|machine learning|ml|ai|data|mobile|ios|android)\s+(?:engineer|developer|architect|scientist)/gi,
          'Product': /(?:product manager|product designer|ux designer|ui designer|head of product|vp of product)/gi,
          'Sales': /(?:account executive|sales development|business development|sales engineer|vp of sales|head of sales)/gi,
          'Marketing': /(?:content manager|marketing manager|growth|demand generation|product marketing|head of marketing)/gi,
          'Operations': /(?:operations manager|chief of staff|finance|accounting|legal|compliance|hr|people ops)/gi,
          'Customer Success': /(?:customer success|account manager|solutions engineer|implementation|support engineer)/gi,
        };

        for (const [dept, pattern] of Object.entries(deptPatterns)) {
          const matches = text.matchAll(pattern);
          for (const m of matches) {
            const title = m[0].replace(/\s+/g, ' ').trim();
            if (title.length > 5 && title.length < 80 && !jobs.find(j => j.title.toLowerCase() === title.toLowerCase())) {
              jobs.push({ title: title.charAt(0).toUpperCase() + title.slice(1), department: dept, location: null });
            }
          }
        }

        if (jobs.length > 3) break; // found enough, stop checking other pages
      } catch { /* try next page */ }
    }

    return jobs.slice(0, 20);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ProductHunt — search via their public API
  // ──────────────────────────────────────────────────────────────────────────
  private async searchProductHunt(name: string): Promise<any | null> {
    try {
      const res = await axios.post(
        'https://api.producthunt.com/v2/api/graphql',
        {
          query: `{
            search(query: "${name.replace(/"/g, '')}", first: 3) {
              edges {
                node {
                  ... on Post {
                    name
                    tagline
                    votesCount
                    commentsCount
                    createdAt
                    makers { name }
                    website
                  }
                }
              }
            }
          }`,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': BOT_AGENT,
          },
          timeout: 10000,
        },
      );

      const edges = res.data?.data?.search?.edges || [];
      const posts = edges.map((e: any) => e.node).filter((n: any) => n?.name);
      if (posts.length === 0) return { found: false, name: null, upvotes: 0, reviews: 0, launchDate: null, makers: [] };

      // Find best match
      const match = posts.find((p: any) =>
        p.name?.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes((p.name || '').toLowerCase()),
      ) || posts[0];

      if (!match) return { found: false, name: null, upvotes: 0, reviews: 0, launchDate: null, makers: [] };

      return {
        found: true,
        name: match.name,
        tagline: match.tagline,
        upvotes: match.votesCount || 0,
        reviews: match.commentsCount || 0,
        launchDate: match.createdAt?.slice(0, 10) || null,
        makers: (match.makers || []).map((m: any) => m.name).filter(Boolean),
      };
    } catch { return null; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Person enrichment — HackerNews + news + GitHub per founder
  // ──────────────────────────────────────────────────────────────────────────
  private async enrichPerson(name: string, title: string | null, linkedinUrl: string | null): Promise<Partial<PersonProfile>> {
    const [hnPosts, newsHits, githubData] = await Promise.all([
      this.searchHackerNews(name).then(hits => hits.slice(0, 3).map((h: any) => ({ title: h.title, points: h.points, date: h.date }))).catch(() => []),
      this.searchGoogleNews(name).then(articles => articles.slice(0, 3).map((a: any) => ({ title: a.title, source: a.source, date: a.date }))).catch(() => []),
      this.findPersonGitHub(name).catch(() => null),
    ]);

    return {
      hnPosts,
      newsHits,
      githubUsername: githubData?.login || null,
      githubActivity: githubData ? `${githubData.public_repos} repos, ${githubData.followers} followers` : null,
      priorCompanies: [],
    };
  }

  private async findPersonGitHub(name: string): Promise<any | null> {
    try {
      const res = await axios.get('https://api.github.com/search/users', {
        params: { q: name, per_page: 3 },
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': BOT_AGENT },
        timeout: 8000,
      });
      const items = res.data?.items || [];
      if (items.length === 0) return null;
      // Get the best match's profile
      const profile = await axios.get(`https://api.github.com/users/${items[0].login}`, {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': BOT_AGENT },
        timeout: 5000,
      });
      return profile.data;
    } catch { return null; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LinkedIn company page — headcount + description
  // ──────────────────────────────────────────────────────────────────────────
  private async scrapeLinkedInCompany(linkedinUrl: string): Promise<{ employeeCount: string | null; description: string | null; foundedYear: number | null } | null> {
    try {
      const res = await axios.get(linkedinUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 10000,
        maxRedirects: 3,
      });

      const html: string = res.data || '';
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

      const empMatch = text.match(/(\d{1,3}(?:,\d{3})*|\d+[-–]\d+)\s+(?:employees|employee)/i);
      const empCount = empMatch ? empMatch[1] : null;

      const foundedMatch = text.match(/Founded[:\s]+(\d{4})/i);
      const foundedYear = foundedMatch ? parseInt(foundedMatch[1]) : null;

      // Extract description from meta or og:description
      const descMatch = html.match(/(?:og:description|twitter:description)[^>]*content="([^"]{20,500})"/i);
      const description = descMatch ? descMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null;

      return { employeeCount: empCount, description, foundedYear };
    } catch { return null; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DD Questions — generate specific questions for gaps in the data
  // ──────────────────────────────────────────────────────────────────────────
  private generateDDQuestions(result: DomainResearchResult): string[] {
    const questions: string[] = [];

    if (result.founders.length === 0) {
      questions.push('Request: Full founder and leadership team list with LinkedIn profiles and CVs');
    }
    if (result.fundingRounds.length === 0 && result.totalFundingAmount === null) {
      questions.push('Request: Full funding history — all rounds, amounts, investors, and dates');
      questions.push('Request: Signed cap table showing all shareholders and ownership percentages');
    } else if (result.fundingRounds.length > 0 && result.investors.length === 0) {
      questions.push('Request: Investor reference list — confirm named investors and get contacts');
    }
    if (!result.employeeCount && !result.linkedinEmployeeCount) {
      questions.push('Request: Current headcount by department (engineering, sales, operations)');
    }
    if (!result.techStack || Object.values(result.techStack).every(a => a.length === 0)) {
      questions.push('Request: Technical architecture overview or engineering team reference call');
    }
    if (result.openRoleCount === 0) {
      questions.push('Verify: Is the company actively hiring? Flat hiring may indicate revenue pressure or pivot');
    }
    if (!result.github) {
      questions.push('Request: Code repository access or technical demo — no public GitHub found');
    }
    if (result.news.length === 0) {
      questions.push('Note: Zero press coverage found — ask company for customer references and case studies');
    }
    if (!result.productHunt?.found) {
      questions.push('Request: Customer traction data (MAU, DAU, NRR, churn rate, named customers)');
    }
    if (!result.foundedYear) {
      questions.push('Verify: Incorporation date and jurisdiction — request certificate of incorporation');
    }

    return questions;
  }
}
