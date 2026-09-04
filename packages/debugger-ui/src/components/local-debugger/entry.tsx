/**
 * Entry point for the standalone local debugger SPA.
 * Built with Vite, served by the local debug server.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { NextIntlClientProvider } from "next-intl";

// Mantine styles
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

// App theme CSS variables
import "../../lib/theme.css";
import "../../styles/globals.css";

import { ShiplightTheme } from "../../lib/themeProvider";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { AuthProvider } from "./stubs/authContext";
import { LocalDebuggerPage } from "./LocalDebuggerPage";
import { installApiFetchInterceptor } from "./installApiFetchInterceptor";
import enMessages from "../../../messages/en.json";

// Session-scope every /api/* request to the /debugger/:id/ proxy. Must run
// before any component mounts and issues a fetch.
installApiFetchInterceptor();

const theme = createTheme(ShiplightTheme);

function App() {
  // TODO: detect locale from system/CLI flag; currently hardcoded to English
  return (
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
      <MantineProvider theme={theme} forceColorScheme="dark">
        <ThemeProvider defaultTheme="dark">
          <AuthProvider>
            <LocalDebuggerPage />
          </AuthProvider>
        </ThemeProvider>
      </MantineProvider>
    </NextIntlClientProvider>
  );
}

// In local debugger, hide the debug/restricted component dotted borders
// since all features are always enabled
const style = document.createElement("style");
style.textContent = `[data-restriction-type]::after { display: none !important; }`;
document.head.appendChild(style);

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
