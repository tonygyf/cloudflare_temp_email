import { handleApiRequest } from './routes/api.js';
import { handleFrontendRequest } from './routes/frontend.js';
import { ingestIncomingEmail } from './services/mail-service.js';

export default {
  async email(message, env) {
    try {
      await ingestIncomingEmail(message, env);
    } catch (error) {
      console.error('Failed to process incoming email:', error);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const apiResponse = await handleApiRequest(request, env, url);

    if (apiResponse) {
      return apiResponse;
    }

    return handleFrontendRequest(url);
  }
};
