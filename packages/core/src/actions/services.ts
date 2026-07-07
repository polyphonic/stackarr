import { requestJson } from '../clients/http';
import { maybeServiceBaseUrl, serviceApiKey } from '../clients/serviceConfig';
import { getServiceConfigAction, listServiceConfigsAction, updateServiceConfigAction } from '../serviceCatalog';
import { listServiceFavoritesAction, updateServiceFavoritesAction } from '../serviceFavorites';
import { getServices } from '../services';

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
  const apiKey = serviceApiKey(service);
  let endpoint = baseUrl;
  if (['sonarr', 'sonarr4k', 'radarr', 'radarr4k'].includes(service) && apiKey) {
    endpoint = `${baseUrl}/api/v3/system/status?apikey=${encodeURIComponent(apiKey)}`;
  } else if (service === 'prowlarr' && apiKey) {
    endpoint = `${baseUrl}/api/v1/system/status?apikey=${encodeURIComponent(apiKey)}`;
  } else if (service === 'seerr' && apiKey) {
    endpoint = `${baseUrl}/api/v1/status`;
  }
  try {
    const response = await requestJson(endpoint, {
      headers: service === 'seerr' && apiKey ? { 'X-Api-Key': apiKey } : undefined,
      timeoutMs: 5000
    });
    return { ...summary, baseUrl, reachable: true, response };
  } catch (error) {
    return { ...summary, baseUrl, reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}
