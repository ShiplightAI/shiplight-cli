// Color tokens for the CLI debugger shell (standalone Vite bundle; see
// entry.tsx for why it sits outside the Next.js/Tailwind boundary).
// index.html mirrors bgBase + textBody — keep in sync (covered by a test).

export const colors = {
  // Surface layers — darkest → lightest
  bgBase: "#1a1b1e",          // page / iframe background
  bgPanel: "#141518",         // left tree panel, top tab bar
  bgRaised: "#25262b",        // popovers (context menu)
  bgHover: "#2c2e33",         // hovered rows / focused row
  bgInputHint: "#373a40",     // inline-code chip, menu item hover, scrollbar thumb

  // Content
  textPrimary: "#e9ecef",     // active tab label
  textBody: "#c1c2c5",        // default text
  textMuted: "#909296",       // secondary text, dir arrow
  textDim: "#5c5f66",         // tertiary, disabled, ended-tab label
  textDanger: "#fa5252",      // error h2

  // Accent
  accent: "#7c5cfc",          // active-tab top border, session-indicator dot, spinner top
  scrollbarHover: "#4d5057",  // scrollbar thumb on hover
  spinnerTrack: "#333333",    // spinner background ring (both large + thin variants)
} as const;

export type ColorToken = keyof typeof colors;
