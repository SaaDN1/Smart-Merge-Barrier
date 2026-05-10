export const BACKEND_BASE_URL = "http://localhost:5000";
export const AUTH_EXPIRED_EVENT = "smart-merge-auth-expired";

const AUTH_STORAGE_KEY = "smartMergeAuth";

function buildBackendUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${BACKEND_BASE_URL}${path}`;
}

export function loadStoredAuth() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Failed to load stored auth:", error);
    return null;
  }
}

export function saveStoredAuth(auth) {
  if (!auth?.token) {
    clearStoredAuth();
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export async function apiFetch(path, options = {}) {
  const { skipAuth = false, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  const hasFormBody = typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;

  if (fetchOptions.body && !headers.has("Content-Type") && !hasFormBody) {
    headers.set("Content-Type", "application/json");
  }

  if (!skipAuth) {
    const auth = loadStoredAuth();
    if (auth?.token) {
      headers.set("Authorization", `Bearer ${auth.token}`);
    }
  }

  const response = await fetch(buildBackendUrl(path), {
    ...fetchOptions,
    headers
  });

  if (response.status === 401 && !skipAuth) {
    clearStoredAuth();
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }

  return response;
}

export async function apiJson(path, options = {}) {
  const response = await apiFetch(path, options);
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }

  return payload;
}
