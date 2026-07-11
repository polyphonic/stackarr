const composeSource = 'https://raw.githubusercontent.com/polyphonic/stackarr/production/stackarr/docker-compose.yml';

export function GET() {
  return Response.redirect(composeSource, 307);
}
