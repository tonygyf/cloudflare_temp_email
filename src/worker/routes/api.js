import { deleteEmailById, getPublicConfig, listEmailsByAddress } from '../services/mail-service.js';
import { apiError, apiJson, handleApiOptions } from '../utils/http.js';

export async function handleApiRequest(request, env, url) {
  if (!url.pathname.startsWith('/api/')) {
    return null;
  }

  const optionsResponse = handleApiOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  if (request.method === 'GET' && url.pathname === '/api/config') {
    return apiJson(getPublicConfig(env));
  }

  if (request.method === 'GET' && url.pathname === '/api/emails') {
    const address = String(url.searchParams.get('address') || '').toLowerCase().trim();

    if (!address) {
      return apiError('Missing address parameter', 400);
    }

    try {
      return apiJson(await listEmailsByAddress(address, env));
    } catch (error) {
      console.error('Failed to fetch emails:', error);
      return apiError(error.message || 'Failed to fetch emails');
    }
  }

  if (request.method === 'DELETE' && url.pathname === '/api/emails') {
    const id = url.searchParams.get('id');
    const address = String(url.searchParams.get('address') || '').toLowerCase().trim();

    if (!id || !address) {
      return apiError('Missing parameters', 400);
    }

    try {
      await deleteEmailById(id, address, env);
      return apiJson({ success: true });
    } catch (error) {
      console.error('Failed to delete email:', error);
      return apiError(error.message || 'Failed to delete email');
    }
  }

  return apiError('Not Found', 404);
}
