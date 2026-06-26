import { prowlarrGet, prowlarrPost } from '../clients/prowlarr';

export const searchReleasesAction = (input: { query: string; categories?: number[]; indexerIds?: number[] }) =>
  prowlarrGet('search', {
    query: input.query,
    categories: input.categories?.join(','),
    indexerIds: input.indexerIds?.join(',')
  });
export const getIndexerStatusAction = () => prowlarrGet('indexer');
export const testIndexersAction = () => prowlarrPost('indexer/testall', {});
export const addReleaseToDownloaderAction = (input: {
  guid?: string;
  indexerId?: number;
  downloadUrl?: string;
  protocol?: string;
}) => prowlarrPost('search', { ...input });
