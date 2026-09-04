import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { TestFunction } from '@/common/models/testFunction';
import { useCallback, useEffect, useState } from 'react';
import { TestCase } from '@/common/models/testCase';

/**
 * Hook to fetch and manage test functions
 */
export function useFunctions(options = {}) {
  const { data, error, isLoading, mutate } = useSWR<any>(
    '/api/functions',
    fetcher.get,
    {
      refreshInterval: 600000, // Refresh every 10 minutes
      dedupingInterval: 60000, // Dedupe requests within 60 seconds
      ...options
    }
  );

  const functions = data || [];

  /**
   * Refresh functions
   */
  const refreshFunctions = async (): Promise<void> => {
    await mutate();
  };

  /**
   * Get a function by its ID
   */
  const getFunctionById = (id: number): TestFunction | null => {
    return functions.find((func: TestFunction) => func.id === id) || null;
  };

  /**
   * Get a function by its name
   */
  const getFunctionByName = (name: string): TestFunction | null => {
    return functions.find((func: TestFunction) => func.name === name) || null;
  };

  /**
   * Create a new function
   */
  const createFunction = async (name: string, code: string, description?: string): Promise<void> => {
    try {
      await fetcher.post('/api/functions/create', { name, code, description });
      await mutate();
    } catch (error) {
      console.error('Error creating function:', error);
      throw error;
    }
  };

  /**
   * Update a function
   */
  const updateFunction = async (id: number, updates: Partial<TestFunction>): Promise<void> => {
    try {
      await fetcher.put(`/api/functions/${id}/update`, updates);
      await mutate();
    } catch (error) {
      console.error('Error updating function:', error);
      throw error;
    }
  };

  /**
   * Delete a function
   */
  const deleteFunction = async (id: number): Promise<void> => {
    try {
      await fetcher.delete(`/api/functions/${id}/delete`);
      await mutate();
    } catch (error) {
      console.error('Error deleting function:', error);
      throw error;
    }
  };

  return {
    functions,
    isLoading,
    isError: error,
    refreshFunctions,
    getFunctionById,
    getFunctionByName,
    createFunction,
    updateFunction,
    deleteFunction
  };
}

export function useFunction(id: number) {
  const { isLoading, isError, getFunctionById, refreshFunctions } = useFunctions();
  const [data, setData] = useState<TestFunction | null>(null);
  
  useEffect(() => {
    if (!isLoading && !isError) {
      const func = getFunctionById(id);
      setData(func);
    }
  }, [isLoading, isError, getFunctionById, id]);

  return {
    isLoading,
    isError,
    data,
    refresh: refreshFunctions,
  };
}

export function useFunctionTestCases(id: number) {
  const { data, error, isLoading, mutate } = useSWR<any>(
    `/api/functions/${id}/test-cases`,
    fetcher.get,
    {
      refreshInterval: 60000, // Refresh every 1 minute
      dedupingInterval: 60000, // Dedupe requests within 60 seconds
    }
  );

  const refresh = useCallback(async () => {
    await mutate();
  }, [mutate]);

  return {
    data: data as any as TestCase[],
    isLoading,
    error,
    refresh,
  };
}