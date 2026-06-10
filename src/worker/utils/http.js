const API_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function mergeHeaders(baseHeaders, extraHeaders = {}) {
  return {
    ...baseHeaders,
    ...extraHeaders
  };
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: mergeHeaders(
      {
        'Content-Type': 'application/json; charset=UTF-8'
      },
      init.headers
    )
  });
}

export function apiJson(data, init = {}) {
  return json(data, {
    ...init,
    headers: mergeHeaders(API_CORS_HEADERS, init.headers)
  });
}

export function apiError(message, status = 500) {
  return apiJson({ error: message }, { status });
}

export function handleApiOptions(request) {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  return new Response(null, {
    status: 204,
    headers: API_CORS_HEADERS
  });
}
