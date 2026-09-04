import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for converting S3 paths to temporary HTTP URLs
 *
 * @example
 * // Basic usage - auto-fetch when s3Path changes
 * const { url, loading, error } = useS3ImageUrl(s3Path);
 *
 * @example
 * // Manual control - don't auto-fetch
 * const { url, loading, fetchUrl } = useS3ImageUrl(undefined, { immediate: false });
 * const handleClick = () => fetchUrl(somePath);
 *
 * @example
 * // Using utility functions for one-off conversions
 * const url = await convertS3PathToUrl(s3Path);
 * const urls = await convertMultipleS3PathsToUrls([path1, path2, path3]);
 */

interface UseS3ImageUrlOptions {
  // Whether to fetch immediately when s3Path is provided
  immediate?: boolean;
}

interface UseS3ImageUrlReturn {
  url: string | null;
  loading: boolean;
  error: string | null;
  fetchUrl: (s3Path: string) => Promise<string | null>;
  reset: () => void;
}

/**
 * Custom hook for converting S3 paths to temporary HTTP URLs
 * @param s3Path - Optional S3 path to fetch URL for immediately
 * @param options - Configuration options
 * @returns Object with url, loading state, error, and utility functions
 */
export const useS3ImageUrl = (
  s3Path?: string,
  options: UseS3ImageUrlOptions = {}
): UseS3ImageUrlReturn => {
  const { immediate = true } = options;

  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUrl = useCallback(async (pathToFetch: string): Promise<string | null> => {
    if (!pathToFetch) return null;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/s3/get-image-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ s3Path: pathToFetch }),
      });

      if (!response.ok) {
        throw new Error(`Failed to generate image URL: ${response.statusText}`);
      }

      const data = await response.json();
      const imageUrl = data.url;

      setUrl(imageUrl);
      return imageUrl;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error(`Error generating image URL for ${pathToFetch}:`, err);
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setUrl(null);
    setError(null);
    setLoading(false);
  }, []);

  // Auto-fetch if s3Path is provided and immediate is true
  useEffect(() => {
    if (s3Path && immediate) {
      fetchUrl(s3Path);
    } else if (!s3Path) {
      reset();
    }
  }, [s3Path, immediate, fetchUrl, reset]);

  return {
    url,
    loading,
    error,
    fetchUrl,
    reset,
  };
};

/**
 * Utility function for converting a single S3 path to URL (non-hook version)
 * Useful for one-off conversions or when you don't need state management
 */
export const convertS3PathToUrl = async (s3Path: string): Promise<string | null> => {
  if (!s3Path) return null;

  try {
    const response = await fetch("/api/s3/get-image-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ s3Path }),
    });

    if (!response.ok) {
      console.error(`Failed to convert S3 path to URL: ${s3Path}`);
      return null;
    }

    const data = await response.json();
    return data.url;
  } catch (error) {
    console.error(`Error converting S3 path to URL: ${s3Path}`, error);
    return null;
  }
};

/**
 * Utility function for converting multiple S3 paths to URLs in parallel
 */
export const convertMultipleS3PathsToUrls = async (
  s3Paths: string[]
): Promise<(string | null)[]> => {
  const promises = s3Paths.map(path => convertS3PathToUrl(path));
  return Promise.all(promises);
};