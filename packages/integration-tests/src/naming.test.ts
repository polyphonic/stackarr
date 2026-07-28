import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const namingConfigUrl = new URL('../../../stackarr/config/naming.json', import.meta.url);

test('Radarr naming emits Plex movie edition tags from the current edition token', async () => {
  const naming = JSON.parse(await readFile(namingConfigUrl, 'utf8'));

  assert.equal(naming.radarr.movieFolderFormat, '{Movie Title} ({Release Year})');
  assert.equal(
    naming.radarr.standardMovieFormat,
    '{Movie Title} ({Release Year}) {edition-{Edition Tags}} [{Quality Full}.{MediaInfo VideoCodec}.{MediaInfo AudioCodec}.{MediaInfo AudioChannels}]'
  );
  assert.doesNotMatch(JSON.stringify(naming.radarr), /Movie Edition/);
});

test('tinyMediaManager preserves explicitly edition-tagged TV show folders', async () => {
  const naming = JSON.parse(await readFile(namingConfigUrl, 'utf8'));

  assert.equal(naming.tinymediamanager.tvShows.renamerTvShowFoldername, '');
});

test('tinyMediaManager preserves a Plex movie edition marker when its edition field is empty', async () => {
  const naming = JSON.parse(await readFile(namingConfigUrl, 'utf8'));
  const movieFilenamePattern = naming.tinymediamanager.movies.renamerFilename;

  assert.equal(naming.tinymediamanager.movies.renamerPathname, '${title} (${year})');
  assert.match(movieFilenamePattern, /\$\{if edition\} \{edition-\$\{edition\}\}\$\{else\}/);
  assert.match(
    movieFilenamePattern,
    /\$\{@regexp \(\?i\)\(\\x20\\x7Bedition-\[\^\\x7D\]\+\\x7D\) movie\.mainVideoFile\.filename \$1\}/
  );
});
