import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { useRouter } from 'next/router';
import { UserProfile } from '@/common/models/userProfile';
import { Organization } from '@/common/models/organization';
import { closeTestCaseIndexedDB, initializeTestCaseIndexedDB } from '@/lib/indexeddb/testCaseIndexedDB';
import { destroyTestCaseSyncService, initializeTestCaseSyncService } from '@/lib/sync/testCaseSyncService';

interface AuthState {
  user: UserProfile | null;
  organization: Organization | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  checkAuth: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  requireAuth?: boolean;
}

export function AuthProvider({ children, requireAuth = true }: AuthProviderProps) {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    organization: null,
    loading: true,
    error: null,
    isAuthenticated: false,
  });

  useEffect(() => {
  }, [router.query]);

  const checkAuth = async () => {
    try {
      setAuthState((prev) => ({ ...prev, loading: true, error: null }));

      // Use native fetch instead of fetcher to handle 401 responses properly
      const response = await fetch('/api/auth/me');

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          await Promise.all([
            initializeTestCaseIndexedDB(data.user.organizationId),
            initializeTestCaseSyncService(data.user.organizationId),
          ]);
          // Create UserProfile instance from API response
          const userProfile = new UserProfile(
            data.user.id,
            data.user.fullName || '',
            data.user.email,
            undefined, // avatarUrl
            undefined, // signedUrl
            data.user.firstName,
            data.user.lastName,
            data.user.organizationId,
            data.user.role,
          );

          setAuthState({
            user: userProfile,
            organization: data.organization,
            loading: false,
            error: null,
            isAuthenticated: true,
          });
        } else {
          destroyTestCaseSyncService();
          closeTestCaseIndexedDB();
          setAuthState({
            user: null,
            organization: null,
            loading: false,
            error: null,
            isAuthenticated: false,
          });
        }
      } else if (response.status === 401) {
        // 401 is expected when not logged in - not an error
        destroyTestCaseSyncService();
        closeTestCaseIndexedDB();
        setAuthState({
          user: null,
          organization: null,
          loading: false,
          error: null,
          isAuthenticated: false,
        });
      } else {
        // Other HTTP errors are actual errors
        destroyTestCaseSyncService();
        closeTestCaseIndexedDB();
        const errorData = await response.json().catch(() => ({}));
        setAuthState({
          user: null,
          organization: null,
          loading: false,
          error: errorData.message || `HTTP ${response.status}: ${response.statusText}`,
          isAuthenticated: false,
        });
      }
    } catch (error: any) {
      // Network errors, etc.
      destroyTestCaseSyncService();
      closeTestCaseIndexedDB();
      setAuthState({
        user: null,
        organization: null,
        loading: false,
        error: error?.message || 'Authentication check failed',
        isAuthenticated: false,
      });
    }
  };

  const refreshAuth = async () => {
    await checkAuth();
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Listen for organization mismatch events and refresh page
  useEffect(() => {
    const handleOrganizationMismatch = () => {
      // Refresh the page to reload with new organization
      window.location.reload();
      // console.log('Organization mismatch detected');
    };

    window.addEventListener('organization-mismatch', handleOrganizationMismatch);

    return () => {
      window.removeEventListener('organization-mismatch', handleOrganizationMismatch);
    };
  }, []);

  useEffect(() => {
    if (!authState.loading) {
      if (requireAuth && !authState.isAuthenticated) {
        // User is not authenticated but page requires auth
        const redirectTo = window.location.href;
        router.push(`/login?redirect_to=${encodeURIComponent(redirectTo)}`);
      } else if (!requireAuth && authState.isAuthenticated && router.pathname === '/login') {
        const redirectTo = router.query.redirect_to as string;
        if (redirectTo) {
          window.location.href = redirectTo;
          return;
        }

        // User is authenticated but on login page
        router.push('/test-cases');
      }
    }
  }, [authState.loading, authState.isAuthenticated, requireAuth, router]);

  const contextValue: AuthContextType = {
    ...authState,
    checkAuth,
    refreshAuth,
  };

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
