export * from '@stackarr/db/generated';
export { database } from './client';

import type { Prisma } from '@stackarr/db/generated';
import { database } from './client';

export type TelemetryPayload = {
  schemaVersion: number;
  eventId: string;
  eventName: string;
  generatedAt: string;
  install: {
    id: string;
    channel: string;
    appVersion: string;
    osFamily: string;
    arch: string;
  };
  setup: {
    onboardingComplete: boolean;
    installMode: string;
    databaseMode: string;
  };
  services: {
    enabled: string[];
    dockerManaged: string[];
    nativeManaged: string[];
    mediaServers: Record<string, string>;
  };
  backups: Record<string, unknown>;
  counts: Record<string, unknown>;
  health?: Record<string, unknown>;
};

export async function recordTelemetryEvent(input: { payload: TelemetryPayload; receivedAt?: Date }) {
  const { payload } = input;
  const receivedAt = input.receivedAt ?? new Date();
  const generatedAt = new Date(payload.generatedAt);
  const existing = await database.telemetryInstallation.findUnique({
    where: { installId: payload.install.id },
    select: { lastSeenAt: true }
  });

  if (existing && receivedAt.getTime() - existing.lastSeenAt.getTime() < 60 * 60 * 1000) {
    return { accepted: true, throttled: true, installId: payload.install.id, eventId: payload.eventId };
  }

  await database.$transaction([
    database.telemetryInstallation.upsert({
      where: { installId: payload.install.id },
      create: {
        installId: payload.install.id,
        firstSeenAt: receivedAt,
        lastSeenAt: receivedAt,
        channel: payload.install.channel,
        appVersion: payload.install.appVersion,
        osFamily: payload.install.osFamily,
        arch: payload.install.arch,
        setupInstallMode: payload.setup.installMode,
        databaseMode: payload.setup.databaseMode,
        enabledServices: json(payload.services.enabled),
        mediaServers: json(payload.services.mediaServers),
        backups: json(payload.backups),
        counts: json(payload.counts)
      },
      update: {
        lastSeenAt: receivedAt,
        channel: payload.install.channel,
        appVersion: payload.install.appVersion,
        osFamily: payload.install.osFamily,
        arch: payload.install.arch,
        setupInstallMode: payload.setup.installMode,
        databaseMode: payload.setup.databaseMode,
        enabledServices: json(payload.services.enabled),
        mediaServers: json(payload.services.mediaServers),
        backups: json(payload.backups),
        counts: json(payload.counts)
      }
    }),
    database.telemetryEvent.upsert({
      where: { id: payload.eventId },
      create: {
        id: payload.eventId,
        installId: payload.install.id,
        schemaVersion: payload.schemaVersion,
        eventName: payload.eventName,
        generatedAt,
        receivedAt,
        payload: json(payload)
      },
      update: {}
    })
  ]);

  return { accepted: true, installId: payload.install.id, eventId: payload.eventId };
}

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}
