import { apiCatalog, textHeaders } from '~/lib/discovery';

export const dynamic = 'force-static';

export function GET() {
  return new Response(`${JSON.stringify(apiCatalog(), null, 2)}\n`, {
    headers: textHeaders('application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"; charset=utf-8')
  });
}
