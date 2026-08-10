import 'server-only';

import { createClient, type SanityClient } from '@sanity/client';
import { getPublicSanityConfig, sanityApiVersion } from './config';

let client: SanityClient | null | undefined;

export function getSanityClient() {
  if (client !== undefined) return client;
  const config = getPublicSanityConfig();
  client = config
    ? createClient({
        ...config,
        apiVersion: sanityApiVersion,
        perspective: 'published',
        useCdn: true
      })
    : null;
  return client;
}

export async function safeSanityFetch<T>(query: string, params: Record<string, unknown>, fallback: T): Promise<T> {
  const sanityClient = getSanityClient();
  if (!sanityClient) return fallback;

  try {
    return await sanityClient.fetch<T>(query, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Sanity fetch error';
    console.warn(`Stackarr CMS fetch failed: ${message}`);
    return fallback;
  }
}
