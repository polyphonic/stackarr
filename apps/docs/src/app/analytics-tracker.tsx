'use client';

import { sendGTMEvent } from '@next/third-parties/google';
import { useEffect } from 'react';

type AnalyticsValue = boolean | number | string;
type AnalyticsPayload = Record<string, AnalyticsValue>;
type PendingAnalyticsPayload = Record<string, AnalyticsValue | null | undefined>;

type InterestPayload = {
  interest_group: string;
  interest_label?: string;
  interest_type: string;
};

const trafficSourceSessionKey = 'stackarr:traffic-source-v1';

const trackedSearchParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

const paidClickParams = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'] as const;

const paidClickSources: Record<(typeof paidClickParams)[number], string> = {
  fbclid: 'meta',
  gbraid: 'google',
  gclid: 'google',
  msclkid: 'microsoft',
  ttclid: 'tiktok',
  wbraid: 'google'
};

const searchHostHints = ['baidu.', 'bing.', 'duckduckgo.', 'ecosia.', 'google.', 'yahoo.', 'yandex.'];

const socialHostHints = [
  'bsky.app',
  'facebook.',
  'instagram.',
  'linkedin.',
  'mastodon.',
  'pinterest.',
  'reddit.',
  't.co',
  'threads.',
  'tiktok.',
  'x.com',
  'youtube.'
];

const mediaPlatformHints = [
  'servarr',
  'sonarr',
  'radarr',
  'lidarr',
  'readarr',
  'prowlarr',
  'bazarr',
  'plex',
  'jellyfin',
  'overseerr',
  'jellyseerr',
  'qbittorrent',
  'transmission',
  'docker'
];

const leadingWwwRegex = /^www\./;

function compactPayload(payload: PendingAnalyticsPayload): AnalyticsPayload {
  const compact: AnalyticsPayload = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    compact[key] = value;
  }

  return compact;
}

function sendAnalyticsEvent(name: string, payload: PendingAnalyticsPayload) {
  sendGTMEvent({ event: name, ...compactPayload(payload) });
}

function normalizeHost(hostname: string) {
  return hostname.replace(leadingWwwRegex, '').toLowerCase();
}

function toUrl(value: string) {
  try {
    return new URL(value, window.location.href);
  } catch {
    return null;
  }
}

function toSafeUrl(value: string, options?: { keepSearch?: boolean }) {
  const url = toUrl(value);

  if (!url) {
    return value;
  }

  url.hash = '';

  if (options?.keepSearch === false) {
    url.search = '';
  }

  return url.toString();
}

function getUrlHost(value: string) {
  const url = toUrl(value);
  return url?.hostname ? normalizeHost(url.hostname) : undefined;
}

function hostIncludes(hostname: string | undefined, hints: string[]) {
  if (!hostname) {
    return false;
  }

  return hints.some((hint) => hostname.includes(hint));
}

function getMediumChannel(medium: string | null | undefined) {
  if (!medium) {
    return 'campaign';
  }

  const normalizedMedium = medium.toLowerCase();

  if (
    [
      'affiliate',
      'cpa',
      'cpc',
      'cpm',
      'cpv',
      'display',
      'paid',
      'paid_social',
      'ppc',
      'retargeting',
      'remarketing'
    ].includes(normalizedMedium)
  ) {
    return 'paid';
  }

  if (normalizedMedium.includes('email')) {
    return 'email';
  }

  if (normalizedMedium.includes('social')) {
    return 'social';
  }

  if (normalizedMedium.includes('organic')) {
    return 'organic_search';
  }

  if (normalizedMedium.includes('referral')) {
    return 'referral';
  }

  return 'campaign';
}

function getPaidClickSource(searchParams: URLSearchParams) {
  return paidClickParams.find((param) => searchParams.has(param));
}

function getTrafficSource(searchParams: URLSearchParams, referrer: string) {
  const utmSource = searchParams.get('utm_source')?.trim();
  const utmMedium = searchParams.get('utm_medium')?.trim();
  const paidClickParam = getPaidClickSource(searchParams);
  const referrerDomain = getUrlHost(referrer);
  const currentDomain = normalizeHost(window.location.hostname);

  if (utmSource || utmMedium) {
    return {
      channel: getMediumChannel(utmMedium),
      medium: utmMedium ?? 'campaign',
      referrerDomain,
      source: utmSource ?? (paidClickParam ? paidClickSources[paidClickParam] : 'campaign')
    };
  }

  if (paidClickParam) {
    return {
      channel: 'paid',
      medium: 'paid',
      referrerDomain,
      source: paidClickSources[paidClickParam]
    };
  }

  if (!referrerDomain) {
    return {
      channel: 'direct',
      medium: 'none',
      referrerDomain,
      source: 'direct'
    };
  }

  if (referrerDomain === currentDomain) {
    return {
      channel: 'internal',
      medium: 'internal',
      referrerDomain,
      source: 'internal'
    };
  }

  if (hostIncludes(referrerDomain, searchHostHints)) {
    return {
      channel: 'organic_search',
      medium: 'organic',
      referrerDomain,
      source: referrerDomain
    };
  }

  if (hostIncludes(referrerDomain, socialHostHints)) {
    return {
      channel: 'social_referral',
      medium: 'social',
      referrerDomain,
      source: referrerDomain
    };
  }

  return {
    channel: 'referral',
    medium: 'referral',
    referrerDomain,
    source: referrerDomain
  };
}

function getTrafficSearchParams(searchParams: URLSearchParams) {
  const payload: PendingAnalyticsPayload = {};

  for (const param of trackedSearchParams) {
    payload[param] = searchParams.get(param)?.trim();
  }

  for (const param of paidClickParams) {
    payload[`has_${param}`] = searchParams.has(param) || undefined;
  }

  return payload;
}

function getViewportPayload() {
  return {
    screen_height: window.screen.height,
    screen_width: window.screen.width,
    viewport_height: window.innerHeight,
    viewport_width: window.innerWidth
  };
}

function getTrafficSourcePayload() {
  const searchParams = new URLSearchParams(window.location.search);
  const source = getTrafficSource(searchParams, document.referrer);

  return {
    ...getTrafficSearchParams(searchParams),
    ...getViewportPayload(),
    landing_path: window.location.pathname,
    language: navigator.language,
    page_location: toSafeUrl(window.location.href),
    page_referrer: document.referrer ? toSafeUrl(document.referrer, { keepSearch: false }) : undefined,
    page_title: document.title,
    referrer_domain: source.referrerDomain,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    traffic_channel: source.channel,
    traffic_medium: source.medium,
    traffic_source: source.source
  };
}

function hasSentTrafficSource() {
  try {
    if (window.sessionStorage.getItem(trafficSourceSessionKey)) {
      return true;
    }

    window.sessionStorage.setItem(trafficSourceSessionKey, '1');
    return false;
  } catch {
    return false;
  }
}

function getEventElement(target: EventTarget | null) {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function isTrackableAnchor(anchor: HTMLAnchorElement) {
  const url = toUrl(anchor.href);
  return Boolean(url && url.protocol !== 'javascript:');
}

function isOutboundUrl(url: URL) {
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return normalizeHost(url.hostname) !== normalizeHost(window.location.hostname);
  }

  return true;
}

function isSameSiteUrl(url: URL) {
  return normalizeHost(url.hostname) === normalizeHost(window.location.hostname);
}

function getLinkPosition(value: string | undefined) {
  if (!value) {
    return;
  }

  const position = Number(value);
  return Number.isFinite(position) ? position : undefined;
}

function getLinkText(anchor: HTMLAnchorElement) {
  return (
    anchor.dataset.analyticsLabel ??
    anchor.getAttribute('aria-label') ??
    anchor.title ??
    anchor.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120)
  );
}

function getLinkLocation(anchor: HTMLAnchorElement) {
  if (anchor.dataset.analyticsLink) {
    return anchor.dataset.analyticsLink;
  }

  const section = anchor.closest<HTMLElement>('[data-analytics-section], section[id], nav, header, footer');

  if (section?.dataset.analyticsSection) {
    return section.dataset.analyticsSection;
  }

  if (section?.id) {
    return section.id;
  }

  if (section?.tagName) {
    return section.tagName.toLowerCase();
  }

  return 'unlabeled_link';
}

function inferMediaPlatform(hostname: string | undefined, linkText: string | undefined) {
  const haystack = `${hostname ?? ''} ${linkText ?? ''}`.toLowerCase();
  return mediaPlatformHints.find((platform) => haystack.includes(platform));
}

function getLinkPlatform(anchor: HTMLAnchorElement, url: URL, linkText: string | undefined) {
  if (anchor.dataset.analyticsPlatform) {
    return anchor.dataset.analyticsPlatform;
  }

  const hostname = normalizeHost(url.hostname);

  if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
    return 'github';
  }

  if (hostname === 'hub.docker.com' || hostname.endsWith('.docker.com') || hostname === 'docker.com') {
    return 'docker';
  }

  const mediaPlatform = inferMediaPlatform(hostname, linkText);

  if (mediaPlatform) {
    return mediaPlatform;
  }

  if (isSameSiteUrl(url)) {
    if (url.pathname.startsWith('/docs/agent') || url.pathname.includes('/mcp')) {
      return 'agent_docs';
    }

    if (url.pathname.startsWith('/docs')) {
      return 'docs';
    }

    return 'stackarr_site';
  }

  return hostname;
}

function getDatasetInterest(anchor: HTMLAnchorElement): InterestPayload | undefined {
  if (!anchor.dataset.analyticsInterest) {
    return;
  }

  return {
    interest_group: anchor.dataset.analyticsInterestGroup ?? 'project',
    interest_label: anchor.dataset.analyticsInterestLabel ?? getLinkText(anchor),
    interest_type: anchor.dataset.analyticsInterest
  };
}

function getProjectInterest(
  anchor: HTMLAnchorElement,
  url: URL,
  linkText: string | undefined
): InterestPayload | undefined {
  const datasetInterest = getDatasetInterest(anchor);

  if (datasetInterest) {
    return datasetInterest;
  }

  const hostname = normalizeHost(url.hostname);

  if (hostname === 'github.com' || hostname.endsWith('.github.com')) {
    return {
      interest_group: 'oss',
      interest_label: 'github',
      interest_type: 'github_repository'
    };
  }

  if (hostname === 'hub.docker.com' || hostname.endsWith('.docker.com') || hostname === 'docker.com') {
    return {
      interest_group: 'install',
      interest_label: 'docker',
      interest_type: 'docker_image'
    };
  }

  if (isSameSiteUrl(url)) {
    if (url.hash === '#download') {
      return {
        interest_group: 'install',
        interest_label: 'download_section',
        interest_type: 'download_section'
      };
    }

    if (url.pathname === '/docs/getting-started' || url.pathname.startsWith('/docs/installation')) {
      return {
        interest_group: 'install',
        interest_label: 'installation',
        interest_type: 'install_docs'
      };
    }

    if (url.pathname.startsWith('/docs/agent') || url.pathname.includes('/mcp')) {
      return {
        interest_group: 'agent',
        interest_label: 'mcp',
        interest_type: 'agent_docs'
      };
    }

    if (url.pathname.startsWith('/docs')) {
      return {
        interest_group: 'docs',
        interest_label: 'documentation',
        interest_type: 'documentation'
      };
    }
  }

  const mediaPlatform = inferMediaPlatform(hostname, linkText);

  if (mediaPlatform) {
    return {
      interest_group: 'media_stack',
      interest_label: mediaPlatform,
      interest_type: 'media_stack_service'
    };
  }
}

function getLinkType(anchor: HTMLAnchorElement, url: URL, interest: InterestPayload | undefined) {
  if (anchor.dataset.analyticsLinkType) {
    return anchor.dataset.analyticsLinkType;
  }

  if (interest?.interest_type) {
    return interest.interest_type;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return url.protocol.replace(':', '');
  }

  if (url.hash && isSameSiteUrl(url) && url.pathname === window.location.pathname) {
    return 'anchor';
  }

  return isOutboundUrl(url) ? 'external' : 'internal';
}

function getLinkClickPayload(anchor: HTMLAnchorElement): PendingAnalyticsPayload {
  const url = toUrl(anchor.href);

  if (!url) {
    return {};
  }

  const linkText = getLinkText(anchor);
  const interest = getProjectInterest(anchor, url, linkText);

  return {
    ...getViewportPayload(),
    interest_group: interest?.interest_group,
    interest_label: interest?.interest_label,
    interest_type: interest?.interest_type,
    link_classes: typeof anchor.className === 'string' ? anchor.className : undefined,
    link_domain: getUrlHost(anchor.href),
    link_id: anchor.dataset.analyticsLinkId ?? anchor.id,
    link_location: getLinkLocation(anchor),
    link_platform: getLinkPlatform(anchor, url, linkText),
    link_position: getLinkPosition(anchor.dataset.analyticsLinkPosition),
    link_protocol: url.protocol.replace(':', ''),
    link_text: linkText,
    link_type: getLinkType(anchor, url, interest),
    link_url: toSafeUrl(anchor.href),
    outbound: isOutboundUrl(url),
    page_path: window.location.pathname,
    page_title: document.title
  };
}

function handleDocumentClick(event: MouseEvent) {
  const element = getEventElement(event.target);
  const anchor = element?.closest<HTMLAnchorElement>('a[href]');

  if (!(anchor && document.documentElement.contains(anchor))) {
    return;
  }

  if (!isTrackableAnchor(anchor)) {
    return;
  }

  const payload = getLinkClickPayload(anchor);
  sendAnalyticsEvent('link_click', payload);

  if (payload.interest_type) {
    sendAnalyticsEvent('project_interest', payload);
  }
}

export function AnalyticsTracker() {
  useEffect(() => {
    if (!hasSentTrafficSource()) {
      sendAnalyticsEvent('traffic_source', getTrafficSourcePayload());
    }

    document.addEventListener('click', handleDocumentClick, {
      capture: true
    });

    return () => {
      document.removeEventListener('click', handleDocumentClick, {
        capture: true
      });
    };
  }, []);

  return null;
}
