export const mediaProfilePresetOptions = ['lite', 'balanced'] as const;
export type MediaProfilePreset = (typeof mediaProfilePresetOptions)[number];

export const musicProfilePresetOptions = ['lossless', 'lossy'] as const;
export type MusicProfilePreset = (typeof musicProfilePresetOptions)[number];

export function normalizeMediaProfilePreset(value: string | undefined): MediaProfilePreset {
  return value === 'balanced' ? 'balanced' : 'lite';
}

export function normalizeMusicProfilePreset(value: string | undefined): MusicProfilePreset {
  return value === 'lossy' ? 'lossy' : 'lossless';
}

export function mediaProfileNameFromPreset(value: string | undefined, resolution: 'hd' | '4k') {
  const preset = normalizeMediaProfilePreset(value);

  if (preset === 'balanced') {
    return resolution === '4k' ? '4K' : 'HD';
  }

  return resolution === '4k' ? '4K Lite' : 'HD Lite';
}

export function musicProfileNameFromPreset(value: string | undefined) {
  return normalizeMusicProfilePreset(value) === 'lossy' ? 'Lossy 256+' : 'Lossless';
}
