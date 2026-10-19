// Firebase web configuration is fetched at runtime from /api/config.
// Do not hardcode Firebase configuration values in frontend source files.
export async function getFirebaseConfig() {
  const response = await fetch('/api/config', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) {
    let message = 'Unable to load Firebase configuration.';
    try {
      const result = await response.json();
      if (result && typeof result.error === 'string') message = result.error;
    } catch (_) {
      // Keep the generic error when the endpoint doesn't return JSON.
    }
    throw new Error(message);
  }

  return response.json();
}
