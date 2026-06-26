import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { githubUrl } from '~/lib/site';

export const logo = <img alt="Stackarr" aria-label="Stackarr" height={24} src="/icon.svg" width={24} />;

export const baseOptions: BaseLayoutProps = {
  githubUrl,
  nav: {
    title: (
      <>
        {logo}
        <span>Stackarr</span>
      </>
    ),
    transparentMode: 'top'
  }
};
