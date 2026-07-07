export type StreamripFieldType = 'text' | 'password' | 'number' | 'checkbox' | 'select' | 'json';

export type StreamripConfigField = {
  id: string;
  section: string;
  name: string;
  label: string;
  type: StreamripFieldType;
  defaultValue: unknown;
  options?: string[];
  description?: string;
  secret?: boolean;
};

export type StreamripConfigGroup = {
  title: string;
  section: string;
  description?: string;
  fields: StreamripConfigField[];
};

type FieldInput = Omit<StreamripConfigField, 'id' | 'section' | 'label'> & { label?: string };

type SectionInput = {
  title: string;
  section: string;
  description?: string;
  fields: FieldInput[];
};

const qualityOptions = {
  qobuz: ['1', '2', '3', '4'],
  tidal: ['0', '1', '2', '3'],
  deezer: ['0', '1', '2'],
  single: ['0'],
  artwork: ['thumbnail', 'small', 'large', 'original']
};

const sections: SectionInput[] = [
  section('Downloads', 'downloads', [
    text('folder', '', 'Folder where tracks are downloaded.'),
    checkbox('source_subdirectories', false, 'Put albums in source-named subfolders.'),
    checkbox('disc_subdirectories', true, 'Put multi-disc albums into Disc N folders.'),
    checkbox('concurrency', true, 'Download and convert tracks concurrently.'),
    number('max_connections', 6, 'Maximum concurrent track downloads. -1 means no limit.'),
    number('requests_per_minute', 60, 'Maximum API requests per source per minute. -1 means no limit.'),
    checkbox('verify_ssl', true, 'Verify API SSL certificates.')
  ]),
  section('Qobuz', 'qobuz', [
    select('quality', 3, qualityOptions.qobuz, '1=320kbps, 2=16/44.1, 3=24/<=96, 4=24/>=96.'),
    checkbox('download_booklets', true, 'Download included booklet PDFs.'),
    checkbox('use_auth_token', false, 'Authenticate with auth token instead of email/password hash.'),
    text('email_or_userid', '', 'Email, or user id when use_auth_token is enabled.'),
    password('password_or_token', '', 'Password hash or auth token.'),
    password('app_id', '', 'Qobuz app id. Usually discovered by Streamrip.'),
    secretJson('secrets', [], 'Qobuz app secrets. Usually discovered by Streamrip.')
  ]),
  section('Tidal', 'tidal', [
    select('quality', 3, qualityOptions.tidal, '0=256 AAC, 1=320 AAC, 2=HiFi FLAC, 3=MQA/HiRes FLAC.'),
    checkbox('download_videos', true, 'Download videos included in video albums.'),
    text('user_id', ''),
    text('country_code', ''),
    password('access_token', ''),
    password('refresh_token', ''),
    text('token_expiry', '', 'Unix timestamp when the token expires.')
  ]),
  section('Deezer', 'deezer', [
    select('quality', 2, qualityOptions.deezer, '0=MP3 128, 1=MP3 320, 2=FLAC.'),
    checkbox('lower_quality_if_not_available', true, 'Fallback to best available quality.'),
    password('arl', '', 'Deezer ARL authentication cookie.'),
    checkbox('use_deezloader', true, 'Use deezloader when no ARL is provided.'),
    checkbox('deezloader_warnings', true, 'Warn when falling back to deezloader.')
  ]),
  section('SoundCloud', 'soundcloud', [
    select('quality', 0, qualityOptions.single),
    password('client_id', ''),
    text('app_version', '')
  ]),
  section('YouTube', 'youtube', [
    select('quality', 0, qualityOptions.single),
    checkbox('download_videos', false),
    text('video_downloads_folder', '')
  ]),
  section('Database', 'database', [
    checkbox('downloads_enabled', true, 'Skip tracks already recorded in the downloads database.'),
    text('downloads_path', ''),
    checkbox('failed_downloads_enabled', true, 'Record failed downloads for rip repair.'),
    text('failed_downloads_path', '')
  ]),
  section('Conversion', 'conversion', [
    checkbox('enabled', false),
    select('codec', 'ALAC', ['FLAC', 'ALAC', 'OPUS', 'MP3', 'VORBIS', 'AAC']),
    number('sampling_rate', 48000),
    select('bit_depth', 24, ['16', '24']),
    number('lossy_bitrate', 320)
  ]),
  section('Qobuz Filters', 'qobuz_filters', [
    checkbox('extras', false),
    checkbox('repeats', false),
    checkbox('non_albums', false),
    checkbox('features', false),
    checkbox('non_studio_albums', false),
    checkbox('non_remaster', false)
  ]),
  section('Artwork', 'artwork', [
    checkbox('embed', true),
    select('embed_size', 'large', qualityOptions.artwork),
    number('embed_max_width', -1),
    checkbox('save_artwork', false),
    number('saved_max_width', -1)
  ]),
  section('Metadata', 'metadata', [
    checkbox('set_playlist_to_album', false),
    checkbox('renumber_playlist_tracks', false),
    json('exclude', [], 'Metadata fields to exclude.')
  ]),
  section('File Paths', 'filepaths', [
    checkbox('add_singles_to_folder', false),
    text('folder_format', '{albumartist} - {title} ({year}) [{container}] [{bit_depth}B-{sampling_rate}kHz]'),
    text('track_format', '{tracknumber:02}. {artist} - {title}'),
    checkbox('restrict_characters', false),
    number('truncate_to', 120)
  ]),
  section('Last.fm', 'lastfm', [
    select('source', 'qobuz', ['qobuz', 'tidal', 'deezer', 'soundcloud']),
    select('fallback_source', '', ['', 'qobuz', 'tidal', 'deezer', 'soundcloud'])
  ]),
  section('CLI', 'cli', [
    checkbox('text_output', true),
    checkbox('progress_bars', true),
    number('max_search_results', 100)
  ]),
  section('Misc', 'misc', [text('version', ''), checkbox('check_for_updates', true)])
];

export const streamripConfigGroups: StreamripConfigGroup[] = sections.map((item) => ({
  title: item.title,
  section: item.section,
  description: item.description,
  fields: item.fields.map((field) => ({
    ...field,
    id: `${item.section}.${field.name}`,
    section: item.section,
    label: field.label ?? field.name
  }))
}));

export const streamripConfigFields = streamripConfigGroups.flatMap((group) => group.fields);

export function getStreamripDefaultConfig() {
  const config: Record<string, Record<string, unknown>> = {};
  for (const group of streamripConfigGroups) {
    config[group.section] = Object.fromEntries(group.fields.map((field) => [field.name, field.defaultValue]));
  }
  return config;
}

export function findStreamripField(id: string) {
  return streamripConfigFields.find((field) => field.id === id);
}

function section(title: string, section: string, fields: FieldInput[], description?: string): SectionInput {
  return { title, section, fields, description };
}
function text(name: string, defaultValue: string, description?: string): FieldInput {
  return { name, type: 'text', defaultValue, description };
}
function password(name: string, defaultValue: string, description?: string): FieldInput {
  return { name, type: 'password', defaultValue, description, secret: true };
}
function number(name: string, defaultValue: number, description?: string): FieldInput {
  return { name, type: 'number', defaultValue, description };
}
function checkbox(name: string, defaultValue: boolean, description?: string): FieldInput {
  return { name, type: 'checkbox', defaultValue, description };
}
function select(name: string, defaultValue: string | number, options: string[], description?: string): FieldInput {
  return { name, type: 'select', defaultValue, options, description };
}
function json(name: string, defaultValue: unknown, description?: string): FieldInput {
  return { name, type: 'json', defaultValue, description };
}
function secretJson(name: string, defaultValue: unknown, description?: string): FieldInput {
  return { name, type: 'json', defaultValue, description, secret: true };
}
