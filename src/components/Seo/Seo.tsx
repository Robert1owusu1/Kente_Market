import { useEffect } from 'react';

interface SeoProps {
  title: string;
  description?: string;
  /** Absolute canonical URL. Defaults to current browser URL without query/hash. */
  url?: string;
  image?: string;
  type?: string;
  keywords?: string;
  /** Structured data (JSON-LD). Accepts an object, an array, or a raw string. */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>> | string;
}

const SITE_NAME = 'Bonwire Kente Marketplace';
const DEFAULT_TITLE = 'Bonwire Kente - Authentic Ghanaian Kente Cloth';
const DEFAULT_DESCRIPTION =
  'Buy authentic Ghanaian Kente cloth, fabrics and custom-printed products online.';
const DEFAULT_IMAGE = 'https://kente-market.vercel.app/og-cover.png';

const upsertMeta = (attr: 'name' | 'property', key: string, content: string) => {
  const selector = attr === 'name' ? `meta[name="${key}"]` : `meta[property="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  el.removeAttribute('data-seo-default');
};

const removeTagged = () => {
  document.head
    .querySelectorAll<HTMLScriptElement>('script[data-seo-jsonld="true"]')
    .forEach((el) => el.remove());
};

const Seo = ({ title, description, url, image, type, keywords, jsonLd }: SeoProps) => {
  useEffect(() => {
    const base = `${window.location.origin}`;
    const canonical = url || `${base}${window.location.pathname}`;
    const previousTitle = document.querySelector('title')?.textContent || DEFAULT_TITLE;
    const previousDesc =
      document.querySelector('meta[name="description"]')?.getAttribute('content') || DEFAULT_DESCRIPTION;

    // Base tags that should always exist.
    upsertMeta('property', 'og:site_name', SITE_NAME);
    upsertMeta('name', 'twitter:card', 'summary_large_image');

    document.title = title;
    upsertMeta('name', 'description', description || DEFAULT_DESCRIPTION);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description || DEFAULT_DESCRIPTION);
    upsertMeta('property', 'og:url', canonical);
    upsertMeta('property', 'og:type', type || 'website');
    upsertMeta('property', 'og:image', image || DEFAULT_IMAGE);
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description || DEFAULT_DESCRIPTION);
    upsertMeta('name', 'twitter:image', image || DEFAULT_IMAGE);

    if (keywords) upsertMeta('name', 'keywords', keywords);

    let canonicalLink = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = canonical;

    removeTagged();
    if (jsonLd) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.seoJsonld = 'true';
      script.textContent =
        typeof jsonLd === 'string' ? jsonLd : JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    return () => {
      document.title = previousTitle;
      upsertMeta('name', 'description', previousDesc);
      document.head
        .querySelectorAll<HTMLElement>('script[data-seo-jsonld="true"]')
        .forEach((el) => el.remove());
    };
  }, [title, description, url, image, type, keywords, jsonLd]);

  return null;
};

export default Seo;