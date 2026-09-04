// api-client.ts

import { apiUrl } from "../apiBase";

interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  errMsg?: string;
}

export const fetcher = {
  async get(url: string, options: RequestOptions = {}) {
    const { headers = {}, timeout = 10000, errMsg } = options;
    const resolved = apiUrl(url);

    try {
      const response = await fetch(resolved, {
        headers: {
          ...headers,
        },
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        throw new Error(errMsg || resolved + ` error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`[Fetcher] Error fetching ${resolved}:`, error);
      throw error;
    }
  },

  async post(url: string, data: any, options: RequestOptions = {}) {
    const { headers = {}, timeout = 30000, errMsg } = options;
    const resolved = apiUrl(url);

    try {
      const response = await fetch(resolved, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        throw new Error(errMsg || response.statusText);
      }

      return response.json();
    } catch (error) {
      console.error(`[Fetcher] Error posting to ${resolved}:`, error);
      throw error;
    }
  },

  async put(url: string, data: any, options: RequestOptions = {}) {
    const { headers = {}, timeout = 30000, errMsg } = options;
    const resolved = apiUrl(url);

    try {
      const response = await fetch(resolved, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        throw new Error(errMsg || resolved + ` error! status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      console.error(`[Fetcher] Error putting to ${resolved}:`, error);
      throw error;
    }
  },

  async patch(url: string, data: any, options: RequestOptions = {}) {
    const { headers = {}, timeout = 30000, errMsg } = options;
    const resolved = apiUrl(url);

    try {
      const response = await fetch(resolved, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        throw new Error(errMsg || resolved + ` error! status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      console.error(`[Fetcher] Error patching ${resolved}:`, error);
      throw error;
    }
  },

  async delete(url: string, data: any = {}, options: RequestOptions = {}) {
    const { headers = {}, timeout = 30000, errMsg } = options;
    const resolved = apiUrl(url);

    try {
      const response = await fetch(resolved, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        throw new Error(errMsg || resolved + ` error! status: ${response.status}`);
      }

      return response.json();
    } catch (error) {
      console.error(`[Fetcher] Error deleting at ${resolved}:`, error);
      throw error;
    }
  },
};

// SWR-friendly GET fetcher: returns null on non-2xx instead of throwing.
// Use as the second arg to `useSWR(key, nullableFetcher)` when a missing
// resource should render empty state instead of an error.
export async function nullableFetcher<T = unknown>(url: string): Promise<T | null> {
  const response = await fetch(apiUrl(url));
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}
