import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useLocalStorage } from "@mantine/hooks";

export type Theme = "light" | "dark" | "auto";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
}

const THEME_STORAGE_KEY = "shiplight-theme";

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, defaultTheme = "auto" }) => {
  const [theme, setThemeState] = useLocalStorage<Theme>({
    key: THEME_STORAGE_KEY,
    defaultValue: defaultTheme,
    serialize: (value) => value,
    deserialize: (value) => value as Theme,
  });
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  // Get system preference
  const getSystemTheme = useCallback((): "light" | "dark" => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, []);

  // Resolve theme based on current setting
  const resolveTheme = useCallback((currentTheme: Theme): "light" | "dark" => {
    if (currentTheme === "auto") {
      return getSystemTheme();
    }
    return currentTheme;
  }, [getSystemTheme]);

  // Apply theme to document
  const applyTheme = (resolvedTheme: "light" | "dark") => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;

    // Use Mantine's color scheme attribute for consistency
    root.setAttribute("data-mantine-color-scheme", resolvedTheme);

    // Also set our custom attribute for backward compatibility
    root.removeAttribute("data-theme");
    if (resolvedTheme === "dark") {
      root.setAttribute("data-theme", "dark");
    }
  };

  // Set theme with persistence
  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    const resolved = resolveTheme(newTheme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  };

  // Toggle between light and dark (skips auto)
  const toggleTheme = () => {
    const currentResolved = resolveTheme(theme);
    const newTheme = currentResolved === "light" ? "dark" : "light";
    setTheme(newTheme);
  };

  // Initialize theme on mount
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, [theme, resolveTheme]);

  // Listen for system theme changes when theme is 'auto'
  useEffect(() => {
    if (theme !== "auto") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      const resolved = resolveTheme(theme);
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, resolveTheme]);

  const value: ThemeContextType = {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
