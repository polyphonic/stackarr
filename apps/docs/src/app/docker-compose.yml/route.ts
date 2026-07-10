const composeSource =
  'https://raw.githubusercontent.com/b-bot/Stackarr/production/stackarr/docker-compose.yml';

export function GET() {
  return Response.redirect(composeSource, 307);
}
