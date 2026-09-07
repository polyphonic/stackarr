import type { ServiceConfigModel } from '@stackarr/core';

export function valuesFromConfig(config: ServiceConfigModel, adding = false): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const primaryFlags: Record<string, string> = {
    radarr: 'ENABLE_MOVIES',
    sonarr: 'ENABLE_TV_SHOWS',
    radarr4k: 'ENABLE_4K_SERVARR',
    sonarr4k: 'ENABLE_4K_SERVARR'
  };
  const enableKey = primaryFlags[config.service.name] ?? `ENABLE_${config.service.name.toUpperCase()}`;
  for (const group of config.groups) {
    for (const field of group.fields) {
      const enabling = adding && field.source.source === 'env' && field.source.key === enableKey;
      const installing =
        adding &&
        field.source.source === 'env' &&
        field.source.key === `${config.service.name.toUpperCase()}_INSTALL_MODE`;
      values[field.id] = enabling
        ? true
        : installing
          ? 'docker'
          : field.secret
            ? ''
            : field.type === 'json'
              ? JSON.stringify(field.value ?? {}, null, 2)
              : field.value;
    }
  }
  return values;
}
