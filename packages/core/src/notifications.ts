import { spawn } from 'node:child_process';
import { databaseExists, insertNotificationRow, readNotificationRows } from './database';

export type WebhookEvent =
  | 'Test'
  | 'Health'
  | 'HealthRestored'
  | 'StackStart'
  | 'StackStop'
  | 'Configure'
  | 'Backup'
  | 'Update'
  | 'ServiceStateChange'
  | 'SetupComplete';

export type Notification = {
  id: number;
  name: string;
  implementation: 'Webhook' | 'CustomScript';
  enabled: boolean;
  url?: string;
  path?: string;
  events: WebhookEvent[];
};

export const webhookEvents: WebhookEvent[] = [
  'Test',
  'Health',
  'HealthRestored',
  'StackStart',
  'StackStop',
  'Configure',
  'Backup',
  'Update',
  'ServiceStateChange',
  'SetupComplete'
];

export function readNotifications(): Notification[] {
  if (databaseExists()) {
    return readSqliteNotifications();
  }

  return [];
}

export function writeNotification(notification: Omit<Notification, 'id'>): Notification {
  const id = insertNotificationRow({
    ...notification,
    enabled: notification.enabled ? 1 : 0,
    events: JSON.stringify(notification.events)
  });

  return { id, ...notification };
}

export function notificationSchema() {
  return [
    {
      implementation: 'Webhook',
      configContract: 'WebhookSettings',
      fields: [
        { name: 'url', label: 'URL', type: 'url', required: true },
        { name: 'events', label: 'Events', type: 'select', options: webhookEvents }
      ]
    },
    {
      implementation: 'CustomScript',
      configContract: 'CustomScriptSettings',
      fields: [
        { name: 'path', label: 'Path', type: 'path', required: true },
        { name: 'events', label: 'Events', type: 'select', options: webhookEvents }
      ]
    }
  ];
}

export async function dispatchNotification(event: WebhookEvent, payload: Record<string, unknown>) {
  const notifications = readNotifications().filter(
    (notification) => notification.enabled && notification.events.includes(event)
  );

  const bodyData = {
    eventType: event,
    instanceName: 'Stackarr',
    applicationUrl: 'http://localhost:7777',
    ...payload
  };
  const serialized = JSON.stringify(bodyData);

  await Promise.allSettled(
    notifications.map((notification) => {
      if (notification.implementation === 'Webhook' && notification.url) {
        const url = normalizeWebhookUrl(notification.url);
        if (!url) {
          return Promise.resolve();
        }

        return fetch(url, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'content-type': 'application/json',
            'x-stackarr-event': event
          },
          body: serialized
        });
      }

      if (notification.implementation === 'CustomScript' && notification.path?.trim()) {
        const scriptPath = notification.path.trim();
        return new Promise<void>((resolve, reject) => {
          try {
            const child = spawn(scriptPath, [event, serialized], {
              env: {
                ...process.env,
                STACKARR_EVENT: event,
                STACKARR_EVENT_TYPE: event,
                STACKARR_PAYLOAD: serialized
              },
              stdio: ['pipe', 'ignore', 'ignore']
            });

            child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
              if (err.code !== 'EPIPE') {
                // Ignore EPIPE if child exited before reading stdin
              }
            });

            child.on('error', reject);
            child.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`CustomScript ${scriptPath} exited with code ${code}`));
              }
            });

            if (child.stdin) {
              child.stdin.end(serialized);
            }
          } catch (error) {
            reject(error);
          }
        });
      }

      return Promise.resolve();
    })
  );
}

function normalizeWebhookUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function readSqliteNotifications(): Notification[] {
  return readNotificationRows().map((item) => ({
    id: item.id,
    name: item.name,
    implementation: item.implementation,
    enabled: Boolean(item.enabled),
    url: item.url ?? undefined,
    path: item.path ?? undefined,
    events: parseEvents(item.events)
  }));
}

function parseEvents(value: string): WebhookEvent[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((event): event is WebhookEvent => webhookEvents.includes(event));
    }
  } catch {
    // Fall through to default.
  }

  return ['Test'];
}
