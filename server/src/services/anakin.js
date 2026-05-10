const ANAKIN_API_BASE = "https://api.anakin.io/v1";

async function anakinFetch(path, apiKey, init = {}) {
  const response = await fetch(`${ANAKIN_API_BASE}${path}`, {
    ...init,
    headers: {
      "X-API-Key": apiKey,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      body?.error?.message || body?.message || `Anakin request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

export async function listCatalogs(apiKey) {
  return anakinFetch("/holocron/catalog", apiKey);
}

export async function getCatalogBySlug(apiKey, slug) {
  return anakinFetch(`/holocron/catalog/${encodeURIComponent(slug)}`, apiKey);
}

export async function searchActions(apiKey, query) {
  const url = new URL(`${ANAKIN_API_BASE}/holocron/search`);
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(body?.error?.message || `Search failed: ${response.status}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

export async function listIdentities(apiKey) {
  return anakinFetch("/holocron/identities", apiKey);
}

export async function listSessions(apiKey) {
  return anakinFetch("/sessions", apiKey);
}

export async function executeWireTask(apiKey, payload) {
  return anakinFetch("/holocron/task", apiKey, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getWireJob(apiKey, jobId) {
  return anakinFetch(`/holocron/jobs/${jobId}`, apiKey);
}

export async function pollWireJob(apiKey, jobId, intervalMs = 2000, timeoutMs = 45000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = await getWireJob(apiKey, jobId);
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("Timed out waiting for Wire job completion.");
}

export function normalizeSessions(sessionResponse = {}, identityResponse = {}) {
  const sessions = (sessionResponse.sessions || []).map((session) => ({
    id: session.id,
    kind: "browser_session",
    label: session.name || session.id,
    catalogSlug: null,
    authType: "browser_state",
    source: session,
  }));

  const credentials = (identityResponse.identities || [])
    .flatMap((identity) =>
      (identity.credentials || [])
        .filter((credential) => credential.status === "active")
        .map((credential) => ({
          id: credential.id,
          kind: "identity_credential",
          label: `${identity.name} (${credential.credential_type})`,
          catalogSlug: identity.catalog_slug || null,
          authType: credential.credential_type,
          source: {
            identity,
            credential,
          },
        })),
    );

  return [...sessions, ...credentials];
}

export function summarizeCatalogs(catalogResponse = {}) {
  const catalog = catalogResponse.catalog || [];
  const authRequiredCount = catalog.filter((entry) => entry.auth_required).length;

  return {
    catalogCount: catalog.length,
    authRequiredCount,
    topCatalogs: catalog.slice(0, 8).map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      actionCount: entry.action_count,
      authRequired: entry.auth_required,
    })),
  };
}
