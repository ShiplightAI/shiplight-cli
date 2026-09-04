import { Popover, Portal, Switch, type MantineThemeOverride, type MantineColorsTuple, ScrollArea } from "@mantine/core";

const primaryColors: MantineColorsTuple = [
  "var(--shiplight-primary-50)",
  "var(--shiplight-primary-100)",
  "var(--shiplight-primary-200)",
  "var(--shiplight-primary-300)",
  "var(--shiplight-primary-400)",
  "var(--shiplight-primary-500)",
  "var(--shiplight-primary-600)",
  "var(--shiplight-primary-700)",
  "var(--shiplight-primary-800)",
  "var(--shiplight-primary-900)",
]

export const ShiplightTheme: MantineThemeOverride = {
  /** CSS variable-based theme configuration */
  primaryColor: "primary",
  primaryShade: 6,
  colors: {
    primary: primaryColors,
  //   neutral: neutralColors,
  //   success: successColors,
  //   error: errorColors,
  //   warning: warningColors,
  //   info: infoColors,
  //   // Map common semantic names to our color system
  //   red: errorColors,
  //   green: successColors,
  //   yellow: warningColors,
  //   blue: infoColors,
  //   gray: neutralColors,
  //   dark: neutralColors,
  },
  components: {
    ScrollArea: {
      defaultProps: {
        scrollbarSize: 8
      }
    }
  }
};
