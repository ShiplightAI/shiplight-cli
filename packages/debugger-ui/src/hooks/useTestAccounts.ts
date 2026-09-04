import useSWR, { preload, mutate as globalMutate } from "swr";
import { useCallback, useMemo } from "react";
import { fetcher } from "@/utils/fetcher";
import { TestAccountInfo } from "@/components/testcase/TestUserSelection";
import { useOrganization } from "@/hooks/useOrganization";
import { getStorageStateS3Path } from "@/common/utils/storageStateUtils";
import { useAuthContext } from "@/contexts/AuthContext";

const getTestAccountsListKey = () => "/api/test-accounts";

const fetchTestAccountsWithCacheUpdate = async (url: string) => {
  const data = await fetcher.get(url);
  return data;
};

const transformAccountData = (rawAccounts: any[] | undefined) => {
  if (!rawAccounts) return [];

  return rawAccounts
    .map((rawAccount: any) => ({
      id: rawAccount.id,
      username: rawAccount.username,
      password: rawAccount.password,
      name: rawAccount.name,
      createdAt: rawAccount.created_at || rawAccount.createdAt
        ? new Date(rawAccount.created_at || rawAccount.createdAt)
        : undefined,
      environmentId: rawAccount.environment_id || rawAccount.environmentId,
      loginConfig: rawAccount.login_config || rawAccount.loginConfig,
      loginHints: rawAccount.login_hints || rawAccount.loginHints, // Add login hints transformation
    }))
    .sort((a: any, b: any) => a.id - b.id);
};

export function useTestAccounts(swrOptions = {}) {
  const { data, error, isLoading, mutate } = useSWR<any[]>(getTestAccountsListKey(), fetchTestAccountsWithCacheUpdate, {
    refreshInterval: 600000,
    revalidateOnFocus: true,
    dedupingInterval: 300000,
    ...swrOptions,
  });

  const { organization } = useAuthContext();

  const refreshTestAccounts = useCallback(async () => {
    const newData = await mutate();
    return newData;
  }, [mutate]);

  const createTestAccount = useCallback(
    async (accountData: {
      username: string;
      password: string;
      name?: string;
      environmentId: number;
      loginConfig?: Record<string, any>;
      loginHints?: Record<string, any>; // Add loginHints support
    }) => {
      try {
        const response = await fetcher.post("/api/test-accounts/create", accountData);
        await refreshTestAccounts(); // Refresh the list after creation
        return { success: true, data: response };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create test account",
        };
      }
    },
    [refreshTestAccounts],
  );

  const updateTestAccount = useCallback(
    async (id: number, accountData: {
      username: string;
      password: string;
      name?: string;
      environmentId: number;
      loginConfig?: Record<string, any>;
      loginHints?: Record<string, any>; // Add loginHints support
    }) => {
      try {
        const organizationId = organization?.organizationId;

        // Generate new auth_creds S3 path with the updated environment ID
        const authCreds = organizationId
          ? getStorageStateS3Path(organizationId, accountData.username, accountData.environmentId)
          : undefined;

        const updatePayload = {
          ...accountData,
          ...(authCreds && { authCreds: authCreds }),
        };

        const response = await fetcher.put(`/api/test-accounts/${id}`, updatePayload);
        await refreshTestAccounts(); // Refresh the list after update
        return { success: true, data: response };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update test account",
        };
      }
    },
    [refreshTestAccounts, organization],
  );

  const deleteTestAccount = useCallback(
    async (id: number) => {
      try {
        await fetcher.delete(`/api/test-accounts/${id}`);
        await refreshTestAccounts(); // Refresh the list after deletion
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to delete test account",
        };
      }
    },
    [refreshTestAccounts],
  );

  const validateUsername = useCallback(
    (username: string, environmentId: string | number, excludeId?: number) => {
      if (!username) return null;

      // Convert environmentId to number for comparison
      const envId = Number(environmentId);

      const duplicate = data?.find(
        (account) =>
          account.username.toLowerCase() === username.toLowerCase() &&
          account.id !== excludeId &&
          account.environmentId === envId
      );

      return duplicate ? `Username "${username}" already exists in this environment` : null;
    },
    [data],
  );

  const checkTestAccountInUse = useCallback(async (id: number) => {
    try {
      const response = await fetcher.get(`/api/test-accounts/${id}/in-use`);
      return {
        success: true,
        inUse: response.inUse,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to check if test account is in use",
      };
    }
  }, []);

  const clearCache = useCallback(
    async (id: number) => {
      try {
        await fetcher.post(`/api/test-accounts/${id}/clear-cache`, {});
        await refreshTestAccounts(); // Refresh the list after clearing cache
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to clear test account cache",
        };
      }
    },
    [refreshTestAccounts],
  );

  const testAccounts = useMemo(() => transformAccountData(data), [data]);

  return {
    testAccounts,
    isLoading,
    isError: error,
    refreshTestAccounts,
    createTestAccount,
    updateTestAccount,
    deleteTestAccount,
    validateUsername,
    checkTestAccountInUse,
    clearCache,
  };
}

export const preloadTestAccounts = () => {
  preload(getTestAccountsListKey(), fetchTestAccountsWithCacheUpdate);
};
