import { absoluteUrl } from '~/lib/site';

export const dynamic = 'force-static';

export function GET() {
  return new Response(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      '',
      'Content-Signal: ai-train=no, search=yes, ai-input=yes',
      '',
      `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
      ''
    ].join('\n'),
    {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=3600',
        'Content-Type': 'text/plain; charset=utf-8'
      }
    }
  );
}
