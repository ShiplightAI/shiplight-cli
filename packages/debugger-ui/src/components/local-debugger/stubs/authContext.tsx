/**
 * Stub AuthContext for the local debugger.
 * Provides a "local" user with all features enabled.
 */

import React, { createContext, useContext, ReactNode } from "react";

interface AuthContextType {
  user: { email: string; id: string; organizationId: string } | null;
  organization: {
    id: string;
    settings?: {
      features?: Record<string, boolean>;
    };
  } | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  checkAuth: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: { email: "local@shiplight.ai", id: "local", organizationId: "local" },
  organization: {
    id: "local",
    settings: {
      features: {
        pure_vision_mode: true,
      },
    },
  },
  loading: false,
  error: null,
  isAuthenticated: true,
  checkAuth: async () => {},
  refreshAuth: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        user: { email: "local@shiplight.ai", id: "local", organizationId: "local" },
        organization: {
          id: "local",
          settings: {
            features: {
              pure_vision_mode: true,
            },
          },
        },
        loading: false,
        error: null,
        isAuthenticated: true,
        checkAuth: async () => {},
        refreshAuth: async () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
