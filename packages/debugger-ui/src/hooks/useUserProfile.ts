import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "@/utils/fetcher";
import { UserProfile } from "@/common/models/userProfile";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Hook to fetch and manage user profile
 */
export function useUserProfile(options = {}) {
  const { data, error, isLoading, mutate } = useSWR<any>("/api/user-profile", fetcher.get, {
    // Disable automatic updates since profile data rarely changes
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    refreshInterval: 0,
    dedupingInterval: 600000,
    ...options,
  });

  // Extract profile directly from response
  const profile = data?.profile || null;

  /**
   * Refresh user profile - call this explicitly when needed
   */
  const refreshUserProfile = async (): Promise<void> => {
    await mutate();
  };

  /**
   * Update user profile
   */
  const updateUserProfile = async (fullName: string, avatarUrl?: string): Promise<UserProfile | null> => {
    try {
      const response = await fetcher.put("/api/user-profile", {
        full_name: fullName,
        avatar_url: avatarUrl,
      });

      // Update cache with new data without revalidation
      await mutate(response, false);

      return response.profile ? UserProfile.hydrate(response.profile) : null;
    } catch (error) {
      console.error("Error updating user profile:", error);
      throw error;
    }
  };

  /**
   * Upload a new avatar image
   */
  const uploadAvatar = async (file: File): Promise<{ avatar_url: string; signed_url: string } | null> => {
    try {
      const formData = new FormData();
      formData.append("avatar", file, file.name);

      const response = await fetch("/api/user-profile/avatar", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const { avatar_url, signed_url } = await response.json();

      // Update the profile with the new avatar URL without revalidation
      if (profile) {
        const updatedData = {
          ...data,
          profile: {
            ...data.profile,
            avatarUrl: avatar_url,
            signedUrl: signed_url,
          },
        };
        await mutate(updatedData, false);
      }
      console.log("avatar_url", avatar_url);
      console.log("signed_url", signed_url);
      return { avatar_url, signed_url };
    } catch (error) {
      console.error("Error uploading avatar:", error);
      throw error;
    }
  };

  /**
   * Get the full name of the user, with a fallback if not available
   */
  const getFullName = (): string => {
    if (!profile) return "User";

    // Use fullName if available
    if (profile.fullName && profile.fullName.trim()) return profile.fullName.trim();

    // Fallback to firstName + lastName if fullName not available
    if (profile.firstName || profile.lastName) {
      return `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    }

    // Last fallback to email or just "User"
    return profile.email?.split("@")[0] || "User";
  };

  /**
   * Get the avatar URL, with a fallback if not available
   * If an empty string is explicitly set (to clear the avatar), return null
   */
  const getAvatarUrl = (): string | null => {
    if (!profile) return null;
    return profile.signedUrl || profile.avatarUrl || null;
  };

  return {
    profile,
    isLoading,
    isError: error,
    refreshUserProfile,
    updateUserProfile,
    uploadAvatar,
    getFullName,
    getAvatarUrl,
  };
}

const getUserProfileKey = (userId: string) => `/api/user-profile/${userId}`;

/**
 * Hook to fetch user profiles in batch using SWR
 * Automatically deduplicates requests for the same userIds
 * @param userIds - Array of user IDs to fetch profiles for
 * @returns Object containing user profiles, loading state, and error state
 */
export function useUserProfiles(userIds: string[]) {
  // Filter out invalid user IDs (null, undefined, empty strings)
  const validUserIds = useMemo(
    () => userIds.filter((userId) => userId && typeof userId === "string" && userId.trim() !== ""),
    [userIds],
  );

  // Create a stable key for the batch request
  const batchKey = useMemo(() => {
    if (validUserIds.length === 0) return null;
    // Sort userIds to ensure consistent key generation
    const sortedIds = [...validUserIds].sort();
    return `/api/user-profile/batch?ids=${sortedIds.join(",")}`;
  }, [validUserIds]);

  // Custom fetcher for batch requests
  const batchFetcher = useCallback(async (key: string) => {
    const ids = key.split("?ids=")[1]?.split(",") || [];
    if (ids.length === 0) return { profiles: [] };

    try {
      const response = await fetcher.post("/api/user-profile/batch", {
        userIds: ids,
      });

      return response.success ? response : { profiles: [] };
    } catch (error) {
      console.error("Failed to fetch user profiles:", error);
      // Return empty profiles array on error to prevent breaking the filter
      return { profiles: [] };
    }
  }, []);

  // Use SWR for the batch request
  const { data, error, isLoading } = useSWR(batchKey, batchFetcher, {
    // Disable automatic revalidation for better performance
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: false,
    refreshInterval: 0,
    // Cache for 10 minutes to avoid unnecessary requests
    dedupingInterval: 600000,
  });

  // Transform the response into a user profiles object
  const userProfiles = useMemo(() => {
    const profiles: Record<string, UserProfile> = {};

    if (data?.profiles) {
      data.profiles.forEach((profile: UserProfile) => {
        profiles[profile.id] = profile;
      });
    }

    return profiles;
  }, [data]);

  return {
    userProfiles,
    isLoading,
    isError: error,
  };
}
