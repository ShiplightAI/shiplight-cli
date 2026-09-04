import useSWR, { preload } from "swr";
import { useCallback } from "react";
import { fetcher } from "@/utils/fetcher";
import { Environment } from "@/common/models/environment";

const getEnvironmentsListKey = () => "/api/environments";

const fetchEnvironmentsWithCacheUpdate = async (url: string) => {
  const data = await fetcher.get(url);
  return data;
};

/**
 * Hook to fetch and manage environments
 */
export function useEnvironments(swrOptions = {}) {
  const { data, error, isLoading, mutate } = useSWR<any>(getEnvironmentsListKey(), fetchEnvironmentsWithCacheUpdate, {
    refreshInterval: 600000,
    dedupingInterval: 60000,
    ...swrOptions,
  });

  // Convert API response to Environment objects
  const environments = (data || []).map((env: any) => Environment.fromEntity(env));

  const refreshEnvironments = useCallback(async () => {
    const newData = await mutate();
    return newData;
  }, [mutate]);

  const createEnvironment = useCallback(
    async (name: string, url: string) => {
      try {
        const response = await fetcher.post("/api/environments/create", { name, url });
        await refreshEnvironments();
        return { success: true, data: response.response };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Error creating environment",
        };
      }
    },
    [refreshEnvironments],
  );

  const updateEnvironment = useCallback(
    async (id: number, name: string, url: string) => {
      try {
        const response = await fetcher.put(`/api/environments/${id}/environment`, { name, url });
        await refreshEnvironments();
        return { success: true, data: response };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Error updating environment",
        };
      }
    },
    [refreshEnvironments],
  );

  const deleteEnvironment = useCallback(
    async (id: number) => {
      try {
        await fetcher.delete(`/api/environments/${id}/environment`);
        await refreshEnvironments();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Error deleting environment",
        };
      }
    },
    [refreshEnvironments],
  );

  return {
    environments,
    isLoading,
    isError: error,
    refreshEnvironments,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
  };
}

export const preloadEnvironments = () => {
  preload(getEnvironmentsListKey(), fetchEnvironmentsWithCacheUpdate);
};