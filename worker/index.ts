// Minimal type stubs for the Cloudflare Workers runtime (compiled by wrangler).
// Full types: npm i -D @cloudflare/workers-types

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  LISTS: KVNamespace;
  ASSETS: Fetcher;
}

// Maximum stored payload size in bytes (512 KB)
const MAX_BYTES = 512 * 1024;

// Only accept a full 64-char lowercase hex SHA-256 digest as the list ID
const LIST_ID_RE = /^\/api\/list\/([a-f0-9]{64})$/;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isValidPayload(data: unknown): data is { inventories: unknown[] } {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.inventories);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const match = LIST_ID_RE.exec(pathname);

    if (match) {
      const listId = match[1];

      if (request.method === 'GET') {
        const data = await env.LISTS.get(listId);
        if (data === null) return jsonResponse({ error: 'not_found' }, 404);
        return new Response(data, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (request.method === 'PUT') {
        // Reject oversized payloads early using Content-Length
        const cl = parseInt(request.headers.get('Content-Length') ?? '0', 10);
        if (cl > MAX_BYTES) return jsonResponse({ error: 'payload_too_large' }, 413);

        let body: unknown;
        try { body = await request.json(); }
        catch { return jsonResponse({ error: 'invalid_json' }, 400); }

        if (!isValidPayload(body)) return jsonResponse({ error: 'invalid_payload' }, 400);

        const updatedAt = new Date().toISOString();
        const stored = JSON.stringify({ ...body, updatedAt });

        // Double-check actual serialised size
        if (stored.length > MAX_BYTES) return jsonResponse({ error: 'payload_too_large' }, 413);

        await env.LISTS.put(listId, stored);
        return jsonResponse({ updatedAt }, 200);
      }

      return jsonResponse({ error: 'method_not_allowed' }, 405);
    }

    // Fall through to the bundled static SPA for every other path
    return env.ASSETS.fetch(request);
  },
};
