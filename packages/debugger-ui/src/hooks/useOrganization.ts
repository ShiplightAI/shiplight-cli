import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { OrganizationEntity } from '@/common/entities/organizationEntity';
import useOrganizationStore from '@/stores/organizationStore';
import { useEffect } from 'react';

/**
 * Hook to fetch and manage organization data
 * Uses Zustand store for faster access when available
 */
export function useOrganization(options = {}) {
  const { organization: storedOrg, setOrganization } = useOrganizationStore();
  
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean, organization: OrganizationEntity }>(
    '/api/organizations/current', // Only fetch if not in store
    fetcher.get,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
      dedupingInterval: 60000, // 1 minute
      revalidateOnMount: true, // Always fetch fresh on mount
      ...options
    }
  );

  // Update store when organization is fetched (always sync, not just when empty)
  useEffect(() => {
    if (data?.success && data?.organization) {
      setOrganization(data.organization);
    }
  }, [data, setOrganization]);

  // Prioritize organization from store, fallback to fetched data
  const organization = storedOrg || data?.organization || null;
  
  /**
   * Refresh organization data and update store
   */
  const refreshOrganization = async (): Promise<void> => {
    const result = await mutate();
    if (result?.success && result?.organization) {
      setOrganization(result.organization);
    }
  };

  /**
   * Update organization details
   */
  const updateOrganization = async (
    updates: Partial<OrganizationEntity>
  ): Promise<OrganizationEntity | null> => {
    try {
      const response = await fetcher.put('/api/organizations/update', updates);
      
      if (response?.success && response?.organization) {
        // Update the store
        setOrganization(response.organization);
        
        // Update cache without revalidation
        await mutate(response, false);
      }
      
      return response?.organization || null;
    } catch (error) {
      console.error('Error updating organization:', error);
      throw error;
    }
  };

  /**
   * Get the organization name, with a fallback if not available
   */
  const getOrganizationName = (): string => {
    if (!organization) return 'Organization';
    return organization.name || 'Organization';
  };

  /**
   * Get the organization ID
   */
  const getOrganizationId = (): string | null => {
    if (!organization) return null;
    return organization.organization_id || null;
  };

  return {
    organization,
    organizationId: getOrganizationId(),
    isLoading: isLoading && !storedOrg,
    isError: error,
    refreshOrganization,
    updateOrganization,
    getOrganizationName,
    getOrganizationId
  };
} 