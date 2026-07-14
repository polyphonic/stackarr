const packagedVersion = '0.3.0-alpha.4'; // x-release-please-version

export const stackarrVersion = process.env.STACKARR_VERSION?.trim() || packagedVersion;
export const stackarrRevision = process.env.STACKARR_REVISION?.trim() || undefined;

export const stackarrChannel =
  process.env.STACKARR_CHANNEL?.trim() ||
  (stackarrVersion.includes('-alpha.')
    ? 'alpha'
    : stackarrVersion.includes('-beta.')
      ? 'beta'
      : stackarrVersion.includes('-')
        ? 'preview'
        : 'stable');
