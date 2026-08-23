import { ServiceApiError } from '../clients/http';
import { prowlarrGet, prowlarrPost } from '../clients/prowlarr';

export const searchReleasesAction = (input: { query: string; categories?: number[]; indexerIds?: number[] }) =>
  prowlarrGet('search', {
    query: input.query,
    categories: input.categories?.join(','),
    indexerIds: input.indexerIds?.join(',')
  });
export const getIndexerStatusAction = () => prowlarrGet('indexer');
type ProwlarrIndexer = { id: number; name: string; enable?: boolean; [key: string]: unknown };

export async function testIndexersAction() {
  const indexers = await prowlarrGet<ProwlarrIndexer[]>('indexer');
  const enabled = indexers.filter((indexer) => indexer.enable !== false);
  const results = await Promise.all(
    enabled.map(async (indexer) => {
      try {
        await prowlarrPost('indexer/test', indexer, { timeoutMs: 90_000 });
        return { id: indexer.id, name: indexer.name, status: 'passed' as const };
      } catch (error) {
        return {
          id: indexer.id,
          name: indexer.name,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : String(error),
          details: error instanceof ServiceApiError ? error.details : undefined
        };
      }
    })
  );
  const failed = results.filter((result) => result.status === 'failed').length;

  return { tested: results.length, passed: results.length - failed, failed, results };
}
export const addReleaseToDownloaderAction = (input: {
  guid?: string;
  indexerId?: number;
  downloadUrl?: string;
  protocol?: string;
}) => prowlarrPost('search', { ...input });
