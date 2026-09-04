import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { Label } from '@/common/models/label';
import { useMemo } from 'react';

/**
 * Hook to fetch and manage labels
 */
export function useLabels() {
  const { data, error, isLoading, mutate } = useSWR<any>(
    '/api/labels',
    fetcher.get,
    {
      refreshInterval: 60000, // Refresh every 60 seconds
      dedupingInterval: 30000, // Dedupe requests within 5 seconds
    }
  );

  // Convert API response to Label objects
  const labels = useMemo(() => (data ? (data.data || data) : []).map((label: any) => {
    return label instanceof Label
      ? label
      : new Label(
          label.organization_id,
          label.name,
          label.color,
          label.id,
          label.created_at ? new Date(label.created_at) : undefined,
          label.updated_at ? new Date(label.updated_at) : undefined,
        );
  }), [data]);

  /**
   * Get a label by its ID
   */
  const getLabelById = (id: number): Label | null => {
    return labels.find((label: Label) => label.id === id) || null;
  };

  /**
   * Refresh labels
   */
  const refreshLabels = async (): Promise<void> => {
    await mutate();
  };

  /**
   * Add or update a label in the cache
   */
  const addOrUpdateLabel = (newLabel: Label): void => {
    // Only update the cache if we already have data
    if (data) {
      const currentLabels = [...labels];
      const index = currentLabels.findIndex((label) => label.id === newLabel.id);
      
      if (index >= 0) {
        // Update existing label
        currentLabels[index] = newLabel;
      } else {
        // Add new label
        currentLabels.push(newLabel);
      }
      
      // Update the cache optimistically
      mutate(
        data.data ? { data: currentLabels } : currentLabels,
        { revalidate: false }
      );
      
      // Revalidate after a short delay
      setTimeout(() => mutate(), 1000);
    }
  };

  return {
    labels,
    isLoading,
    isError: error,
    getLabelById,
    refreshLabels,
    addOrUpdateLabel
  };
} 