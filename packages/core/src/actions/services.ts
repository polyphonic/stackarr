import { type JsonRequestOptions, requestJson } from '../clients/http';
import { maybeServiceBaseUrl, serviceApiKey } from '../clients/serviceConfig';
import { getServiceConfigAction, listServiceConfigsAction, updateServiceConfigAction } from '../serviceCatalog';
import { listServiceFavoritesAction, updateServiceFavoritesAction } from '../serviceFavorites';
import { getServices } from '../services';
import { getTransmissionSessionStatus } from './downloads';

export function listServicesAction() {
  return getServices();
}

export {
  getServiceConfigAction,
  listServiceConfigsAction,
  listServiceFavoritesAction,
  updateServiceConfigAction,
  updateServiceFavoritesAction
};

export async function getServiceStatusAction({ service }: { service: string }) {
  const summary = getServices().find((item) => item.name === service);
  if (!summary) return { service, status: 'unknown', error: 'Service is not in Stackarr service catalog.' };
  if (summary.mode === 'disabled') return { ...summary, reachable: false };
  const baseUrl = maybeServiceBaseUrl(service);
  if (!baseUrl) {
    return { ...summary, reachable: false, unsupported: true, error: 'Service does not expose an HTTP endpoint.' };
  }
  if (service === 'transmission') {
    try {
      const response = await getTransmissionSessionStatus();
      return { ...summary, baseUrl, reachable: true, response };
    } catch (error) {
      return { ...summary, baseUrl, reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const apiKey = serviceApiKey(service);
  let endpoint = baseUrl;
  let options: JsonRequestOptions = { timeoutMs: 5000 };
  if (['sonarr', 'sonarr4k', 'radarr', 'radarr4k'].includes(service) && apiKey) {
    endpoint = `${baseUrl}/api/v3/system/status?apikey=${encodeURIComponent(apiKey)}`;
  } else if (['prowlarr', 'lidarr'].includes(service) && apiKey) {
    endpoint = `${baseUrl}/api/v1/system/status?apikey=${encodeURIComponent(apiKey)}`;
  } else if (service === 'seerr' && apiKey) {
    endpoint = `${baseUrl}/api/v1/status`;
    options = { ...options, headers: { 'X-Api-Key': apiKey } };
  } else if (service === 'romm') {
    // RomM exposes a native heartbeat rather than a JSON API status document.
    // Its response format varies by release, so accept its documented text or
    // JSON scalar while retaining strict JSON behavior for all other probes.
    endpoint = `${baseUrl}/api/heartbeat`;
    options = { ...options, allowTextResponse: true };
  }
  try {
    const response = await requestJson(endpoint, options);
    return { ...summary, baseUrl, reachable: true, response };
  } catch (error) {
    return { ...summary, baseUrl, reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}
