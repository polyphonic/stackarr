export const sanityApiVersion = '2026-08-10';

export type PublicSanityConfig = {
  projectId: string;
  dataset: string;
};

export function getPublicSanityConfig(): PublicSanityConfig | null {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID?.trim();
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET?.trim() || 'production';

  if (!projectId) {
    return null;
  }

  return { projectId, dataset };
}

export function requirePublicSanityConfig(): PublicSanityConfig {
  const config = getPublicSanityConfig();
  if (!config) {
    throw new Error('NEXT_PUBLIC_SANITY_PROJECT_ID is required for Sanity Studio and schema commands.');
  }
  return config;
}
