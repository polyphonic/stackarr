import { authorizationServerMetadata, jsonResponse } from '~/lib/discovery';

export const dynamic = 'force-static';

export function GET() {
  return jsonResponse(authorizationServerMetadata());
}
