import { jsonResponse, openApiDocument } from '~/lib/discovery';

export const dynamic = 'force-static';

export function GET() {
  return jsonResponse(openApiDocument, {
    headers: {
      'Content-Type': 'application/vnd.oai.openapi+json; charset=utf-8'
    }
  });
}
