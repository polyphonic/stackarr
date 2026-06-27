import {
  IconAppStack,
  IconBell,
  IconBookOpen,
  IconBoxArchive,
  IconCirclePowerOff,
  IconCircleWrench,
  IconCloudDownload,
  IconCube,
  IconFileDownload,
  IconGear,
  IconGrid,
  IconHouse,
  IconImage,
  IconLayers,
  IconLink,
  IconMagnifier,
  IconMonitor,
  IconOpenInBrowser,
  IconRocket,
  IconSettingsWrench,
  IconSlider,
  IconSsd,
  IconStar,
  IconStorage,
  IconTasks
} from 'nucleo-glass';
import type { ComponentType, SVGProps } from 'react';

export { Button } from '@heroui/react/button';
export { Link } from '@heroui/react/link';
export { Modal } from '@heroui/react/modal';
export { Surface } from '@heroui/react/surface';

export type GlassIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  title?: string;
};

export type GlassIcon = ComponentType<GlassIconProps>;

function glassIcon(Icon: GlassIcon): GlassIcon {
  function StackarrGlassIcon({ className, size = 18, ...props }: GlassIconProps) {
    const resolvedSize = typeof size === 'number' ? Math.max(12, Math.round(size * 1.12)) : size;

    return (
      <Icon
        aria-hidden={props['aria-label'] ? undefined : true}
        className={['stackarr-glass-icon', className].filter(Boolean).join(' ')}
        size={resolvedSize}
        {...props}
      />
    );
  }

  StackarrGlassIcon.displayName = `StackarrGlassIcon`;
  return StackarrGlassIcon;
}

export const icons = {
  activity: glassIcon(IconTasks),
  backup: glassIcon(IconBoxArchive),
  bell: glassIcon(IconBell),
  book: glassIcon(IconBookOpen),
  cloud: glassIcon(IconCloudDownload),
  container: glassIcon(IconCube),
  containers: glassIcon(IconAppStack),
  dashboard: glassIcon(IconHouse),
  download: glassIcon(IconFileDownload),
  drive: glassIcon(IconSsd),
  image: glassIcon(IconImage),
  link: glassIcon(IconLink),
  manage: glassIcon(IconTasks),
  network: glassIcon(IconGrid),
  play: glassIcon(IconRocket),
  playSolid: glassIcon(IconRocket),
  refresh: glassIcon(IconCircleWrench),
  search: glassIcon(IconMagnifier),
  settings: glassIcon(IconGear),
  sliders: glassIcon(IconSlider),
  stack: glassIcon(IconLayers),
  star: glassIcon(IconStar),
  starSolid: glassIcon(IconStar),
  stop: glassIcon(IconCirclePowerOff),
  system: glassIcon(IconMonitor),
  trash: glassIcon(IconCirclePowerOff),
  tv: glassIcon(IconOpenInBrowser),
  wrench: glassIcon(IconSettingsWrench)
} satisfies Record<string, GlassIcon>;

export {
  IconAppStack,
  IconBell,
  IconBookOpen,
  IconBoxArchive,
  IconCirclePowerOff,
  IconCircleWrench,
  IconCloudDownload,
  IconCube,
  IconFileDownload,
  IconGear,
  IconGrid,
  IconHouse,
  IconImage,
  IconLayers,
  IconLink,
  IconMagnifier,
  IconMonitor,
  IconOpenInBrowser,
  IconRocket,
  IconSettingsWrench,
  IconSlider,
  IconSsd,
  IconStar,
  IconStorage,
  IconTasks
};
