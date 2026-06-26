import { jsonResponse } from '~/lib/discovery';
import { siteName, siteVersion } from '~/lib/site';

export const dynamic = 'force-static';

export function GET() {
  return jsonResponse({
    name: siteName,
    version: siteVersion,
    status: 'ok',
    service: 'public-docs'
  });
}
