'use client';
import { useEffect, useState } from 'react';

interface Props {
  name: string;
  type?: 'person' | 'company' | 'address';
  size?: number;
}

/* ----- Module-level caches so we only resolve each name once per session ----- */
const wikiCache = new Map<string, string | null>();
const wikiInflight = new Map<string, Promise<string | null>>();

async function fetchWikipediaThumb(name: string): Promise<string | null> {
  if (wikiCache.has(name)) return wikiCache.get(name)!;
  if (wikiInflight.has(name)) return wikiInflight.get(name)!;
  const promise = (async () => {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}?redirect=true`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) return null;
      const data = await res.json();
      // Only use if it's clearly a person page (has thumbnail and isn't a disambiguation)
      if (data.type === 'disambiguation') return null;
      const url = data.thumbnail?.source || data.originalimage?.source || null;
      return url;
    } catch {
      return null;
    }
  })();
  wikiInflight.set(name, promise);
  const result = await promise;
  wikiCache.set(name, result);
  wikiInflight.delete(name);
  return result;
}

/** Slugify a company name into candidate domains (best-effort). */
function companyDomains(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/[\(\)\[\]\.,&'"`]/g, '')
    .replace(/\b(plc|ltd|limited|llp|holdings|group|company|co|inc|corp|corporation|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const noSpaces = cleaned.replace(/\s+/g, '');
  const noDashes = noSpaces.replace(/-/g, '');
  const firstWord = cleaned.split(' ')[0]?.replace(/-/g, '') || noSpaces;

  // Try several variants · the favicon service will return null gracefully
  return Array.from(
    new Set([
      `${noSpaces}.com`,
      `${noDashes}.com`,
      `${noSpaces}.co.uk`,
      `${firstWord}.com`,
    ]),
  ).filter((d) => d.length > 5);
}

export function Avatar({ name, type = 'person', size = 40 }: Props) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  // -------- PERSON --------
  if (type === 'person') {
    const [src, setSrc] = useState<string>(
      `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=171717&textColor=f5f5f5&fontWeight=600`,
    );
    const [tried, setTried] = useState(false);

    useEffect(() => {
      let cancelled = false;
      // Skip Wikipedia lookup for clearly synthetic names (single token, very short)
      if (name.length < 4 || !name.includes(' ')) return;
      fetchWikipediaThumb(name).then((thumb) => {
        if (!cancelled && thumb) setSrc(thumb);
        if (!cancelled) setTried(true);
      });
      return () => { cancelled = true; };
    }, [name]);

    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() =>
          setSrc(`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=171717&textColor=f5f5f5&fontWeight=600`)
        }
        className="rounded-full ring-1 ring-white/10 bg-ink-800 shrink-0 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  // -------- COMPANY --------
  if (type === 'company') {
    return <CompanyLogo name={name} initials={initials} size={size} />;
  }

  // -------- ADDRESS --------
  return (
    <div
      className="rounded-sm bg-ink-800 ring-1 ring-white/5 flex items-center justify-center text-ink-300 font-mono text-[9px] shrink-0"
      style={{ width: size, height: size }}
    >
      ◯
    </div>
  );
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const logoLocalCache = new Map<string, string | null>();

async function fetchLogoUrl(name: string): Promise<string | null> {
  const key = name.trim().toLowerCase();
  // Only return from cache if we have a real URL (not null)
  const cached = logoLocalCache.get(key);
  if (cached) return cached;

  // Check localStorage — only use if it's a real URL
  try {
    const stored = localStorage.getItem(`logo:${key}`);
    if (stored && stored !== 'null') {
      logoLocalCache.set(key, stored);
      return stored;
    }
  } catch {}

  // Fetch from backend
  try {
    const res = await fetch(`${API_URL}/companies/logo?name=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const url = data.url || null;
    if (url) {
      logoLocalCache.set(key, url);
      try { localStorage.setItem(`logo:${key}`, url); } catch {}
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Company logo with backend-resolved URL + initials fallback.
 * Backend checks DuckDuckGo, Logo.dev, Google Favicon with DB caching.
 */
function CompanyLogo({ name, initials, size }: { name: string; initials: string; size: number }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLogoUrl(name).then((url) => {
      if (!cancelled) setLogoUrl(url);
    });
    return () => { cancelled = true; };
  }, [name]);

  // Also try client-side domain guessing as immediate attempt
  const domains = companyDomains(name);
  const clientUrl = domains.length > 0 ? `https://icons.duckduckgo.com/ip3/${domains[0]}.ico` : null;
  const [clientFailed, setClientFailed] = useState(false);

  const showUrl = logoUrl || (clientFailed ? null : clientUrl);

  if (!showUrl) {
    return (
      <div
        className="rounded-md bg-gradient-to-br from-ink-800 to-ink-700 ring-1 ring-white/5 flex items-center justify-center text-ink-100 font-mono text-[10px] tracking-tight shrink-0"
        style={{ width: size, height: size, fontSize: Math.max(10, size * 0.35) }}
      >
        {initials || '?'}
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div
          className="rounded-md bg-gradient-to-br from-ink-800 to-ink-700 ring-1 ring-white/5 flex items-center justify-center text-ink-100 font-mono font-semibold tracking-widest shrink-0"
          style={{ width: size, height: size, fontSize: Math.max(10, size * 0.35), position: loaded ? 'absolute' : 'relative' }}
        >
          {initials || '?'}
        </div>
      )}
      <img
        src={showUrl}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          if (showUrl === clientUrl) setClientFailed(true);
          setLoaded(false);
        }}
        className={`rounded-md ring-1 ring-white/10 bg-white shrink-0 object-contain p-0.5 ${loaded ? '' : 'hidden'}`}
        style={{ width: size, height: size }}
      />
    </>
  );
}
