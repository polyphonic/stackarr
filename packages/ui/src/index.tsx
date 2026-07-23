import {
  IconAppStack,
  IconBell,
  IconBookOpen,
  IconBoxArchive,
  IconCircleArrowRight,
  IconCirclePowerOff,
  IconCircleWrench,
  IconCloudDownload,
  IconCloudUpload,
  IconComputerDownload,
  IconConnections,
  IconCube,
  IconDeleteX,
  IconDotsVertical,
  IconEye,
  IconFileDownload,
  IconGauge,
  IconGear,
  IconGrid,
  IconHouse,
  IconImage,
  IconImageDepth,
  IconKey,
  IconLayers,
  IconLink,
  IconLock,
  IconMagicWandSparkle,
  IconMagnifier,
  IconMonitor,
  IconOpenInBrowser,
  IconPin,
  IconRocket,
  IconSettingsWrench,
  IconSlider,
  IconSsd,
  IconStackPerspective,
  IconStar,
  IconStorage,
  IconSwap,
  IconTasks,
  IconTimelineVertical,
  IconVideo
} from 'nucleo-glass';
import { type ComponentType, type SVGProps, useId } from 'react';

export { Button } from '@heroui/react/button';
export { Description } from '@heroui/react/description';
export { Input } from '@heroui/react/input';
export { Label } from '@heroui/react/label';
export { Link } from '@heroui/react/link';
export { Modal } from '@heroui/react/modal';
export { Surface } from '@heroui/react/surface';
export { Switch } from '@heroui/react/switch';
export { TextArea } from '@heroui/react/textarea';
export { TextField } from '@heroui/react/textfield';

export type GlassIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  title?: string;
  uniqueId?: string;
};

export type GlassIcon = ComponentType<GlassIconProps>;

function glassIcon(Icon: GlassIcon): GlassIcon {
  function StackarrGlassIcon({ className, size = 18, uniqueId, ...props }: GlassIconProps) {
    const generatedId = useId();
    const resolvedSize = typeof size === 'number' ? Math.max(12, Math.round(size * 1.12)) : size;

    return (
      <Icon
        aria-hidden={props['aria-label'] ? undefined : true}
        className={['stackarr-glass-icon', className].filter(Boolean).join(' ')}
        size={resolvedSize}
        uniqueId={uniqueId ?? generatedId}
        {...props}
      />
    );
  }

  StackarrGlassIcon.displayName = `StackarrGlassIcon`;
  return StackarrGlassIcon;
}

export const icons = {
  activity: glassIcon(IconTimelineVertical),
  backup: glassIcon(IconBoxArchive),
  bell: glassIcon(IconBell),
  book: glassIcon(IconBookOpen),
  cloud: glassIcon(IconCloudUpload),
  container: glassIcon(IconCube),
  containers: glassIcon(IconAppStack),
  dashboard: glassIcon(IconHouse),
  download: glassIcon(IconComputerDownload),
  drive: glassIcon(IconSsd),
  image: glassIcon(IconImageDepth),
  link: glassIcon(IconLink),
  open: glassIcon(IconOpenInBrowser),
  eye: glassIcon(IconEye),
  key: glassIcon(IconKey),
  lock: glassIcon(IconLock),
  manage: glassIcon(IconMagicWandSparkle),
  grip: glassIcon(IconDotsVertical),
  network: glassIcon(IconConnections),
  pin: glassIcon(IconPin),
  play: glassIcon(IconCircleArrowRight),
  playSolid: glassIcon(IconCircleArrowRight),
  refresh: glassIcon(IconSwap),
  search: glassIcon(IconMagnifier),
  settings: glassIcon(IconGear),
  sliders: glassIcon(IconSlider),
  stack: glassIcon(IconStackPerspective),
  star: glassIcon(IconStar),
  starSolid: glassIcon(IconStar),
  stop: glassIcon(IconCirclePowerOff),
  system: glassIcon(IconGauge),
  trash: glassIcon(IconDeleteX),
  tv: glassIcon(IconVideo),
  wrench: glassIcon(IconSettingsWrench)
} satisfies Record<string, GlassIcon>;

export {
  IconAppStack,
  IconBell,
  IconBookOpen,
  IconBoxArchive,
  IconCircleArrowRight,
  IconCirclePowerOff,
  IconCircleWrench,
  IconCloudDownload,
  IconCloudUpload,
  IconComputerDownload,
  IconConnections,
  IconCube,
  IconDeleteX,
  IconDotsVertical,
  IconEye,
  IconFileDownload,
  IconGauge,
  IconGear,
  IconGrid,
  IconHouse,
  IconImage,
  IconImageDepth,
  IconKey,
  IconLayers,
  IconLink,
  IconLock,
  IconMagicWandSparkle,
  IconMagnifier,
  IconMonitor,
  IconOpenInBrowser,
  IconPin,
  IconRocket,
  IconSettingsWrench,
  IconSlider,
  IconSsd,
  IconStackPerspective,
  IconStar,
  IconStorage,
  IconSwap,
  IconTasks,
  IconTimelineVertical,
  IconVideo
};
