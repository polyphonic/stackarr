import { readEnv } from '@stackarr/core';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { SetupWizard } from '../../components/SetupWizard';
import { requireDashboardAuth } from '../../lib/serverAuth';

export default async function SetupPage() {
  await requireDashboardAuth('/setup', { allowUnconfigured: true });

  const env = readEnv();

  return (
    <>
      <Toolbar title="Setup" />
      <PageBody>
        <SetupWizard
          initialDefaults={{
            mediaRoot: env.MEDIA_ROOT,
            musicRoot: env.MUSIC_ROOT,
            downloadsRoot: env.DOWNLOADS_ROOT,
            backupRoot: env.BACKUP_ROOT,
            enable4kServarr: /^(1|true|yes|on)$/i.test(env.ENABLE_4K_SERVARR ?? ''),
            movieProfilePreset: env.STACKARR_MOVIE_PROFILE_PRESET,
            movie4kProfilePreset: env.STACKARR_MOVIE_4K_PROFILE_PRESET,
            tvProfilePreset: env.STACKARR_TV_PROFILE_PRESET,
            tv4kProfilePreset: env.STACKARR_TV_4K_PROFILE_PRESET,
            musicProfilePreset: env.STACKARR_MUSIC_PROFILE_PRESET,
            webPort: env.STACKARR_WEB_PORT
          }}
        />
      </PageBody>
    </>
  );
}
