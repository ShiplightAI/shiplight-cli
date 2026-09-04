import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/electron/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // primary color system
        primary: {
          50: "var(--shiplight-primary-50)",
          100: "var(--shiplight-primary-100)",
          200: "var(--shiplight-primary-200)",
          300: "var(--shiplight-primary-300)",
          400: "var(--shiplight-primary-400)",
          500: "var(--shiplight-primary-500)",
          600: "var(--shiplight-primary-600)",
          700: "var(--shiplight-primary-700)",
          800: "var(--shiplight-primary-800)",
          900: "var(--shiplight-primary-900)",
          950: "var(--shiplight-primary-950)",
        },
        // neutral color system
        neutral: {
          50: "var(--shiplight-neutral-50)",
          100: "var(--shiplight-neutral-100)",
          200: "var(--shiplight-neutral-200)",
          300: "var(--shiplight-neutral-300)",
          400: "var(--shiplight-neutral-400)",
          500: "var(--shiplight-neutral-500)",
          600: "var(--shiplight-neutral-600)",
          700: "var(--shiplight-neutral-700)",
          800: "var(--shiplight-neutral-800)",
          900: "var(--shiplight-neutral-900)",
          950: "var(--shiplight-neutral-950)",
        },
        // semantic color system
        success: {
          50: "var(--shiplight-success-50)",
          100: "var(--shiplight-success-100)",
          200: "var(--shiplight-success-200)",
          300: "var(--shiplight-success-300)",
          500: "var(--shiplight-success-500)",
          600: "var(--shiplight-success-600)",
          700: "var(--shiplight-success-700)",
          800: "var(--shiplight-success-800)",
        },
        warning: {
          50: "var(--shiplight-warning-50)",
          100: "var(--shiplight-warning-100)",
          200: "var(--shiplight-warning-200)",
          300: "var(--shiplight-warning-300)",
          500: "var(--shiplight-warning-500)",
          600: "var(--shiplight-warning-600)",
          700: "var(--shiplight-warning-700)",
          800: "var(--shiplight-warning-800)",
        },
        error: {
          50: "var(--shiplight-error-50)",
          100: "var(--shiplight-error-100)",
          200: "var(--shiplight-error-200)",
          300: "var(--shiplight-error-300)",
          500: "var(--shiplight-error-500)",
          600: "var(--shiplight-error-600)",
          700: "var(--shiplight-error-700)",
          800: "var(--shiplight-error-800)",
        },
        info: {
          50: "var(--shiplight-info-50)",
          100: "var(--shiplight-info-100)",
          200: "var(--shiplight-info-200)",
          300: "var(--shiplight-info-300)",
          500: "var(--shiplight-info-500)",
          600: "var(--shiplight-info-600)",
          700: "var(--shiplight-info-700)",
          800: "var(--shiplight-info-800)",
        },
        // fixed color system
        dark: {
          bg: "var(--shiplight-dark-bg)",
          "bg-light": "var(--shiplight-dark-bg-light)",
          "bg-medium": "var(--shiplight-dark-bg-medium)",
          text: "var(--shiplight-dark-text)",
          "text-muted": "var(--shiplight-dark-text-muted)",
          border: "var(--shiplight-dark-border)",
        },
        light: {
          bg: "var(--shiplight-fixed-light-bg)",
          "bg-dark": "var(--shiplight-fixed-light-bg-dark)",
          "bg-medium": "var(--shiplight-fixed-light-bg-medium)",
          text: "var(--shiplight-fixed-light-text)",
          "text-muted": "var(--shiplight-fixed-light-text-muted)",
          border: "var(--shiplight-fixed-light-border)",
        },
      },
      backgroundColor: {
        // application layer background color
        primary: "var(--shiplight-bg-primary)",
        secondary: "var(--shiplight-bg-secondary)",
        tertiary: "var(--shiplight-bg-tertiary)",
        surface: "var(--shiplight-bg-surface)",
        "surface-hover": "var(--shiplight-bg-surface-hover)",
        "surface-active": "var(--shiplight-bg-surface-active)",
        "surface-elevated": "var(--shiplight-bg-surface-elevated)",
        overlay: "var(--shiplight-bg-overlay)",
        backdrop: "var(--shiplight-bg-backdrop)",
        dark: "var(--shiplight-dark-bg)",
        light: "var(--shiplight-light-bg)",
        "info": "var(--shiplight-bg-info)",
        "info-hover": "var(--shiplight-bg-info-hover)",
        "info-active": "var(--shiplight-bg-info-active)",
        "success": "var(--shiplight-bg-success)",
        "success-hover": "var(--shiplight-bg-success-hover)",
        "success-active": "var(--shiplight-bg-success-active)",
        "warning": "var(--shiplight-bg-warning)",
        "warning-hover": "var(--shiplight-bg-warning-hover)",
        "warning-active": "var(--shiplight-bg-warning-active)",
        "error": "var(--shiplight-bg-error)",
        "error-hover": "var(--shiplight-bg-error-hover)",
        "error-active": "var(--shiplight-bg-error-active)",
        // button background color
        "button-primary": "var(--shiplight-button-primary-bg)",
        "button-primary-hover": "var(--shiplight-button-primary-bg-hover)",
        "button-secondary": "var(--shiplight-button-secondary-bg)",
        "button-secondary-hover": "var(--shiplight-button-secondary-bg-hover)",
        "button-tertiary": "var(--shiplight-button-tertiary-bg)",
        "button-tertiary-hover": "var(--shiplight-button-tertiary-bg-hover)",
        "button-danger": "var(--shiplight-button-danger-bg)",
        "button-danger-hover": "var(--shiplight-button-danger-bg-hover)",
        // form element background color
        "input": "var(--shiplight-input-bg)",
        "input-disabled": "var(--shiplight-input-bg-disabled)",
        "input-readonly": "var(--shiplight-input-bg-readonly)",
        "select": "var(--shiplight-select-bg)",
        "checkbox": "var(--shiplight-checkbox-bg)",
        "checkbox-checked": "var(--shiplight-checkbox-bg-checked)",
        // status background color
        "highlight": "var(--shiplight-highlight-bg)",
        "selected": "var(--shiplight-selected-bg)",
        "pinned": "var(--shiplight-pinned-bg)",
        "running": "var(--shiplight-running-bg)",
        // code and terminal background color
        "code": "var(--shiplight-code-bg)",
        "console": "var(--shiplight-console-bg)",
        "inverted": "var(--shiplight-inverted-bg)",
      },
      textColor: {
        // base text color
        primary: "var(--shiplight-text-primary)",
        secondary: "var(--shiplight-text-secondary)",
        tertiary: "var(--shiplight-text-tertiary)",
        quaternary: "var(--shiplight-text-quaternary)",
        inverse: "var(--shiplight-text-inverse)",
        disabled: "var(--shiplight-text-disabled)",
        placeholder: "var(--shiplight-text-placeholder)",
        muted: "var(--shiplight-text-muted)",
        link: "var(--shiplight-text-link)",
        "link-hover": "var(--shiplight-text-link-hover)",
        "link-visited": "var(--shiplight-text-link-visited)",
        // button text color
        "button-primary": "var(--shiplight-button-primary-text)",
        "button-secondary": "var(--shiplight-button-secondary-text)",
        "button-tertiary": "var(--shiplight-button-tertiary-text)",
        "button-danger": "var(--shiplight-button-danger-text)",
        // status text color
        "highlight": "var(--shiplight-highlight-text)",
        "selected": "var(--shiplight-selected-text)",
        "code": "var(--shiplight-code-text)",
        "console": "var(--shiplight-console-text)",
        "console-prompt": "var(--shiplight-console-prompt)",
        "console-error": "var(--shiplight-console-error)",
        "console-warning": "var(--shiplight-console-warning)",
        "console-info": "var(--shiplight-console-info)",
        "inverted": "var(--shiplight-inverted-text)",
      },
      borderColor: {
        // base border color
        primary: "var(--shiplight-border-primary)",
        secondary: "var(--shiplight-border-secondary)",
        subtle: "var(--shiplight-border-subtle)",
        focus: "var(--shiplight-border-focus)",
        hover: "var(--shiplight-border-hover)",
        active: "var(--shiplight-border-active)",
        error: "var(--shiplight-border-error)",
        success: "var(--shiplight-border-success)",
        warning: "var(--shiplight-border-warning)",
        info: "var(--shiplight-border-info)",
        // form element border color
        input: "var(--shiplight-input-border)",
        "input-focus": "var(--shiplight-input-border-focus)",
        "input-error": "var(--shiplight-input-border-error)",
        "input-success": "var(--shiplight-input-border-success)",
        select: "var(--shiplight-select-border)",
        "select-focus": "var(--shiplight-select-border-focus)",
        checkbox: "var(--shiplight-checkbox-border)",
        "checkbox-checked": "var(--shiplight-checkbox-border-checked)",
        // status border color
        "highlight": "var(--shiplight-highlight-border)",
        "selected": "var(--shiplight-selected-border)",
        "pinned": "var(--shiplight-pinned-border)",
        "running": "var(--shiplight-running-border)",
        "code": "var(--shiplight-code-border)",
        "inverted": "var(--shiplight-inverted-border)",
      },
      // spacing system
      spacing: {
        xs: "var(--shiplight-space-xs)",
        sm: "var(--shiplight-space-sm)",
        md: "var(--shiplight-space-md)",
        lg: "var(--shiplight-space-lg)",
        xl: "var(--shiplight-space-xl)",
        "2xl": "var(--shiplight-space-2xl)",
        "3xl": "var(--shiplight-space-3xl)",
        "4xl": "var(--shiplight-space-4xl)",
      },
      // grid template columns
      gridTemplateColumns: {
        // complex site specific column configuration
        'protected': '15rem 1fr',
        '1/4': '25% 75%',
        '1/3': '33.33% 66.66%'
      },
      // animation system
      animation: {
        'spin-slow': 'spin 3s linear infinite',
        'running-spin': 'running-spin var(--shiplight-running-animation-duration) var(--shiplight-running-animation-easing) infinite',
        'slide-in': 'slide-in 0.3s ease-out',
      },
      // keyframe animation
      keyframes: {
        'running-spin': {
          '0%': {
            transform: 'rotate(0deg)',
            opacity: '0.7',
          },
          '50%': {
            opacity: '1',
          },
          '100%': {
            transform: 'rotate(360deg)',
            opacity: '0.7',
          },
        },
        'slide-in': {
          '0%': {
            transform: 'translateX(-100%)',
            opacity: '0',
          },
          '100%': {
            transform: 'translateX(0)',
            opacity: '1',
          },
        },
      },
    },
  },
  plugins: [],
};
export default config;
