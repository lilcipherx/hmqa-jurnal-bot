const gateway = 'http://nginx:8080';

const admin = await globalThis.fetch(`${gateway}/`);
if (admin.status !== 200 || !admin.headers.get('content-type')?.includes('text/html')) {
  throw new Error(`admin gateway probe failed with ${admin.status}`);
}

const documentation = await globalThis.fetch(`${gateway}/documentation`);
if (
  documentation.status !== 200 ||
  !documentation.headers.get('content-type')?.includes('text/html')
) {
  throw new Error(`OpenAPI gateway probe failed with ${documentation.status}`);
}

const catalog = await globalThis.fetch(`${gateway}/api/v1/catalog/journals?locale=en`);
const catalogBody = await catalog.json();
if (catalog.status !== 200 || !Array.isArray(catalogBody.items)) {
  throw new Error(`catalog gateway probe failed with ${catalog.status}`);
}

const unauthenticatedWebhook = await globalThis.fetch(`${gateway}/telegram/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ update_id: 1 }),
});
if (unauthenticatedWebhook.status !== 401) {
  throw new Error(`webhook boundary probe failed with ${unauthenticatedWebhook.status}`);
}

process.stdout.write('Application gateway runtime probes passed.\n');
