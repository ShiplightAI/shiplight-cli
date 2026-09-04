// hooks/useForwardEmailConfigs.ts
//
// This hook manages forward email configurations using SWR
// Key features:
// 1. No automatic caching - data is always fresh
// 2. Manual invalidation after CRUD operations
// 3. Global cache invalidation across all hook instances
//
// Usage example:
// ```
// const { configs, invalidate, createConfig } = useForwardEmailConfigs();
//
// // Manually invalidate cache when needed
// await invalidate();
// ```

import useSWR, { mutate as globalMutate } from "swr";
import { useCallback, useState } from "react";
import { fetcher } from "@/utils/fetcher";
import { notifications } from "@mantine/notifications";

interface ForwardEmailConfig {
  id: number;
  organization_id: string;
  name: string;
  forward_email: string;
  extraction_type: string;
  prompt?: string;
  filter_from_email?: string;
  filter_to_email?: string;
  filter_subject?: string;
  filter_body_contains?: string;
  created_at?: string;
  updated_at?: string;
}

const getForwardEmailConfigsKey = () => "/api/forward-email-configs";

const fetchForwardEmailConfigsWithCacheUpdate = async (url: string) => {
  const data = await fetcher.get(url);
  return data;
};

export const useForwardEmailConfigs = () => {
  const [operationLoading, setOperationLoading] = useState(false);

  // Use SWR for data fetching
  // Note: We intentionally keep caching disabled and rely on manual revalidation
  const { data, error, isLoading, mutate } = useSWR<ForwardEmailConfig[]>(
    getForwardEmailConfigsKey(),
    fetchForwardEmailConfigsWithCacheUpdate,
    {
      revalidateOnFocus: false, // Don't auto-refresh on window focus
      revalidateIfStale: false, // Don't auto-refresh if data is stale
      revalidateOnReconnect: false, // Don't auto-refresh on reconnect
      refreshInterval: 0, // No polling
      dedupingInterval: 300000, // 5 minutes
      keepPreviousData: false, // Don't keep previous data
    },
  );

  const configs = data || [];
  const loading = isLoading;

  // Create a new config
  const createConfig = useCallback(
    async (config: Partial<ForwardEmailConfig>) => {
      try {
        setOperationLoading(true);
        const response = await fetcher.post("/api/forward-email-configs", config);

        // Actively invalidate and refetch the cache
        await mutate(); // Refetch current data

        notifications.show({
          title: "Success",
          message: "Forward email config created successfully",
          color: "green",
        });

        return response;
      } catch (err: any) {
        console.error("Failed to create forward email config:", err);
        notifications.show({
          title: "Error",
          message: err?.message || "Failed to create forward email config",
          color: "red",
        });
        throw err;
      } finally {
        setOperationLoading(false);
      }
    },
    [mutate],
  );

  // Update an existing config
  const updateConfig = useCallback(
    async ({ id, config }: { id: number; config: Partial<ForwardEmailConfig> }) => {
      try {
        setOperationLoading(true);
        await fetcher.put(`/api/forward-email-configs/${id}`, config);

        // Actively invalidate and refetch the cache
        await mutate(); // Refetch current data

        notifications.show({
          title: "Success",
          message: "Forward email config updated successfully",
          color: "green",
        });
      } catch (err: any) {
        console.error("Failed to update forward email config:", err);
        notifications.show({
          title: "Error",
          message: err?.message || "Failed to update forward email config",
          color: "red",
        });
        throw err;
      } finally {
        setOperationLoading(false);
      }
    },
    [mutate],
  );

  // Delete a config
  const deleteConfig = useCallback(
    async (id: number) => {
      try {
        setOperationLoading(true);
        await fetcher.delete(`/api/forward-email-configs/${id}`);

        // Actively invalidate and refetch the cache
        await mutate(); // Refetch current data

        notifications.show({
          title: "Success",
          message: "Forward email config deleted successfully",
          color: "green",
        });
      } catch (err: any) {
        console.error("Failed to delete forward email config:", err);
        notifications.show({
          title: "Error",
          message: err?.message || "Failed to delete forward email config",
          color: "red",
        });
        throw err;
      } finally {
        setOperationLoading(false);
      }
    },
    [mutate],
  );

  // Fetch forwarding verification link from the most recent email received at forward_email.
  // Returns the link string, or null if no verification email was found yet.
  const fetchVerificationLink = useCallback(async (id: number): Promise<{ link: string | null; message?: string }> => {
    const response = await fetcher.post(`/api/forward-email-configs/${id}/fetch-verification-link`, {});
    return { link: response.link as string | null, message: response.message as string | undefined };
  }, []);

  // Manually refresh data (refetch from server)
  const refetch = useCallback(async () => {
    return await mutate();
  }, [mutate]);

  // Helper to manually invalidate cache across all instances
  const invalidate = useCallback(async () => {
    // Invalidate the current instance
    await mutate();
    // Invalidate all instances globally
    await globalMutate(getForwardEmailConfigsKey());
  }, [mutate]);

  return {
    configs,
    isLoading: loading,
    error,
    refetch,
    createConfig,
    updateConfig,
    deleteConfig,
    fetchVerificationLink,
    isCreating: operationLoading,
    isUpdating: operationLoading,
    isDeleting: operationLoading,
    invalidate,
  };
};
