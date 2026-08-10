import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareAlphabeticalLabels,
  compareServicesByDisplayName
} from '../../../apps/frontend/src/lib/serviceOrdering.ts';

test('dashboard integrations sort alphabetically by display name', () => {
  const services = [
    { displayName: 'Youtarr' },
    { displayName: 'Radarr 10' },
    { displayName: 'qBittorrent' },
    { displayName: 'Agregarr' },
    { displayName: 'Radarr 2' }
  ];

  assert.deepEqual(
    services.sort(compareServicesByDisplayName).map((service) => service.displayName),
    ['Agregarr', 'qBittorrent', 'Radarr 2', 'Radarr 10', 'Youtarr']
  );
  assert.ok(compareAlphabeticalLabels('tinyMediaManager', 'Tracearr') < 0);
});
