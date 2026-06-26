import { seerrGet, seerrPost } from '../clients/seerr';

export const getRequestsAction = (input: { take?: number; skip?: number; filter?: string } = {}) =>
  seerrGet('request', { take: input.take ?? 50, skip: input.skip ?? 0, filter: input.filter });
export const createRequestAction = (input: {
  mediaType: 'movie' | 'tv';
  mediaId: number;
  is4k?: boolean;
  seasons?: number[];
}) => seerrPost('request', input);
export const approveRequestAction = (input: { requestId: number }) =>
  seerrPost(`request/${input.requestId}/approve`, {});
export const declineRequestAction = (input: { requestId: number; reason?: string }) =>
  seerrPost(`request/${input.requestId}/decline`, { reason: input.reason });
export const getRequestStatusAction = (input: { requestId: number }) => seerrGet(`request/${input.requestId}`);
