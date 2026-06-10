import { FRONTEND_ASSETS } from '../generated/frontend-assets.js';

function buildHeaders(assetPath, contentType) {
  const isStaticAsset = assetPath.startsWith('/assets/');

  return {
    'Content-Type': contentType,
    'Cache-Control': isStaticAsset ? 'public, max-age=31536000, immutable' : 'no-store'
  };
}

export function handleFrontendRequest(url) {
  const assetPath =
    url.pathname === '/' || !url.pathname.includes('.')
      ? '/index.html'
      : url.pathname;

  const asset = FRONTEND_ASSETS[assetPath];

  if (!asset) {
    return new Response('Not Found', { status: 404 });
  }

  return new Response(asset.body, {
    headers: buildHeaders(assetPath, asset.contentType)
  });
}
