import { lookup } from 'node:dns/promises';
import { BlockList } from 'node:net';

const MAX_REDIRECTS = 3;
const MAX_SOURCE_BYTES = 1_500_000;
const RESERVED_HOST_RE = /(?:^|\.)(?:example|home|internal|invalid|lan|local|localhost|test)$/i;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const SOURCE_CONTENT_TYPES = [
  'text/html',
  'text/markdown',
  'text/plain',
  'application/xhtml+xml',
  'application/xml',
  'application/pdf'
];
const GENERIC_PUBLISHER_WORDS = new Set([
  'and',
  'company',
  'docs',
  'documentation',
  'foundation',
  'inc',
  'of',
  'official',
  'org',
  'organization',
  'project',
  'team',
  'the'
]);

const privateAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4]
]) {
  privateAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32]
]) {
  privateAddresses.addSubnet(network, prefix, 'ipv6');
}

function normalizeWords(value) {
  return String(value)
    .toLowerCase()
    .replace(/&(?:amp|quot|apos|lt|gt);/g, ' ')
    .replace(/&#(?:x[0-9a-f]+|\d+);/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedText(value) {
  return normalizeWords(value).join(' ');
}

function publisherCandidates(publisher) {
  const words = normalizeWords(publisher).filter((word) => !GENERIC_PUBLISHER_WORDS.has(word));
  const candidates = new Set();
  if (words.length) candidates.add(words.join(''));
  if (words.length > 1) candidates.add(words.map((word) => word[0]).join(''));
  for (const word of words) {
    if (word.length >= 4) candidates.add(word);
  }
  return [...candidates].filter((candidate) => candidate.length >= 3);
}

export function publisherMatchesSource(publisher, sourceUrl) {
  const url = new URL(sourceUrl);
  const target = `${url.hostname}${url.pathname}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  return publisherCandidates(publisher).some((candidate) => target.includes(candidate));
}

export function validateSourceIdentity(source) {
  let url;
  try {
    url = new URL(source?.url);
  } catch {
    throw new Error('Source URL must be a valid public HTTPS URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    RESERVED_HOST_RE.test(url.hostname)
  ) {
    throw new Error(`Source URL is not an approved public HTTPS endpoint: ${source?.url}`);
  }
  if (source?.kind === 'primary' && !publisherMatchesSource(source.publisher, url.href)) {
    throw new Error(`Primary source publisher does not match its official URL: ${source.publisher}`);
  }
  return url;
}

export function isSupportedSourceContentType(value) {
  const contentType = String(value ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return SOURCE_CONTENT_TYPES.includes(contentType);
}

async function assertPublicAddress(url) {
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error(`Source hostname did not resolve: ${url.hostname}`);
  for (const address of addresses) {
    const family = address.family === 6 ? 'ipv6' : 'ipv4';
    if (privateAddresses.check(address.address, family)) {
      throw new Error(`Source hostname resolves to a blocked network: ${url.hostname}`);
    }
  }
}

async function readLimitedBody(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error(`Source response exceeds ${MAX_SOURCE_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeHtml(
    value
      .replace(/<(?:script|style|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function extractHeadlines(body) {
  const headlines = [];
  for (const pattern of [/<title\b[^>]*>([\s\S]*?)<\/title>/gi, /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi]) {
    for (const match of body.matchAll(pattern)) {
      const headline = stripHtml(match[1]).replace(/\s+/g, ' ').trim();
      if (headline.length >= 8 && headline.length <= 180) headlines.push(headline);
    }
  }
  return [...new Set(headlines)].slice(0, 30);
}

export function findCopiedSentences(articleMarkdown, sourceText) {
  const source = normalizedText(stripHtml(sourceText));
  if (!source) return [];
  const sentences = String(articleMarkdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[[^\]]+\]\([^)]*\)/g, ' ')
    .split(/(?:[.!?]\s+|\n+)/)
    .map((sentence) => normalizedText(sentence))
    .filter((sentence) => sentence.split(' ').length >= 12 && sentence.length >= 80);
  return [...new Set(sentences.filter((sentence) => source.includes(sentence)))];
}

export async function verifyArticleSources(draft) {
  const verified = [];
  for (const source of draft.sources) {
    let currentUrl = validateSourceIdentity(source);
    let response;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await assertPublicAddress(currentUrl);
      response = await fetch(currentUrl, {
        headers: {
          Accept: 'text/html,text/plain,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1',
          'User-Agent': 'StackarrEditorialVerifier/1.0 (+https://stackarr.app/blog)'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000)
      });
      if (!REDIRECT_STATUS.has(response.status)) break;
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error(`Source exceeded the redirect limit: ${source.url}`);
      }
      currentUrl = validateSourceIdentity({ ...source, url: new URL(location, currentUrl).href });
    }
    if (!response?.ok)
      throw new Error(`Source could not be verified (${response?.status ?? 'network error'}): ${source.url}`);
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
    if (!isSupportedSourceContentType(contentType)) {
      throw new Error(`Source returned an unsupported content type (${contentType || 'missing'}): ${source.url}`);
    }
    const body = await readLimitedBody(response);
    const copiedSentences = contentType === 'application/pdf' ? [] : findCopiedSentences(draft.contentMarkdown, body);
    if (copiedSentences.length) {
      throw new Error(`Article contains a sentence copied verbatim from ${source.url}`);
    }
    verified.push({ finalUrl: currentUrl.href, headlines: extractHeadlines(body), source });
  }
  return verified;
}
