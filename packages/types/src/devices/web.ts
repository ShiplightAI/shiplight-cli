/**
 * Web/Browser Device Definitions (Playwright)
 *
 * Defines Playwright device configurations for web browser testing,
 * including desktop browsers and mobile web emulation.
 *
 * This is the single source of truth for web device configurations.
 * For native mobile devices, see android.ts and ios.ts.
 */

// Browser constants
export const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
export const ADDRESS_BAR_HEIGHT = 112;
export const WINDOW_WIDTH = 1920;
export const WINDOW_HEIGHT = 1080;
export const VIEWPORT_WIDTH = 1920;
export const VIEWPORT_HEIGHT = 1080 - ADDRESS_BAR_HEIGHT;
export const RECORD_VIDEO_WIDTH = 1280;
export const RECORD_VIDEO_HEIGHT = 720;
export const MIN_WINDOW_WIDTH = 500;
export const MIN_WINDOW_HEIGHT = 500;
export const DEFAULT_DEVICE_NAME = "Desktop Chrome";

export enum BrowserType {
  Chromium = "chromium",
  Firefox = "firefox",
  Webkit = "webkit",
}

export interface PlaywrightDevice {
  name: string;
  displayName?: string;
  userAgent: string;
  screen: {
    width: number;
    height: number;
  };
  viewport: {
    width: number;
    height: number;
  };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  defaultBrowserType?: BrowserType;
  channel?: "chrome" | "msedge" | "chrome-beta" | "msedge-beta" | "msedge-dev";
}

export const PLAYWRIGHT_DEVICES: Record<string, PlaywrightDevice> = {
  "Blackberry PlayBook": {
    name: "Blackberry PlayBook",
    userAgent:
      "Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML like Gecko) Version/26.0 Safari/536.2+",
    screen: {
      width: 600,
      height: 1024,
    },
    viewport: {
      width: 600,
      height: 1024,
    },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "BlackBerry Z30": {
    name: "BlackBerry Z30",
    userAgent: "Mozilla/5.0 (BB10; Touch) AppleWebKit/537.10+ (KHTML, like Gecko) Version/26.0 Mobile Safari/537.10+",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "Galaxy Note 3": {
    name: "Galaxy Note 3",
    userAgent:
      "Mozilla/5.0 (Linux; U; Android 4.3; en-us; SM-N900T Build/JSS15J) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.0 Mobile Safari/534.30",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "Galaxy Note II": {
    name: "Galaxy Note II",
    userAgent:
      "Mozilla/5.0 (Linux; U; Android 4.1; en-us; GT-N7100 Build/JRO03C) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.0 Mobile Safari/534.30",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "Galaxy S III": {
    name: "Galaxy S III",
    userAgent:
      "Mozilla/5.0 (Linux; U; Android 4.0; en-us; GT-I9300 Build/IMM76D) AppleWebKit/534.30 (KHTML, like Gecko) Version/26.0 Mobile Safari/534.30",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "Galaxy S5": {
    name: "Galaxy S5",
    userAgent:
      "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Galaxy S8": {
    name: "Galaxy S8",
    userAgent:
      "Mozilla/5.0 (Linux; Android 7.0; SM-G950U Build/NRD90M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 360,
      height: 740,
    },
    viewport: {
      width: 360,
      height: 740,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Galaxy S9+": {
    name: "Galaxy S9+",
    userAgent:
      "Mozilla/5.0 (Linux; Android 8.0.0; SM-G965U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 320,
      height: 658,
    },
    viewport: {
      width: 320,
      height: 658,
    },
    deviceScaleFactor: 4.5,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Galaxy S24": {
    name: "Galaxy S24",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 360,
      height: 780,
    },
    viewport: {
      width: 360,
      height: 780,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Galaxy A55": {
    name: "Galaxy A55",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 480,
      height: 1040,
    },
    viewport: {
      width: 480,
      height: 1040,
    },
    deviceScaleFactor: 2.25,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Galaxy Tab S4": {
    name: "Galaxy Tab S4",
    userAgent:
      "Mozilla/5.0 (Linux; Android 8.1.0; SM-T837A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 712,
      height: 1138,
    },
    viewport: {
      width: 712,
      height: 1138,
    },
    deviceScaleFactor: 2.25,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Galaxy Tab S9": {
    name: "Galaxy Tab S9",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 640,
      height: 1024,
    },
    viewport: {
      width: 640,
      height: 1024,
    },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "iPad (gen 5)": {
    name: "iPad (gen 5)",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 768,
      height: 1024,
    },
    viewport: {
      width: 768,
      height: 1024,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPad (gen 6)": {
    name: "iPad (gen 6)",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 768,
      height: 1024,
    },
    viewport: {
      width: 768,
      height: 1024,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPad (gen 7)": {
    name: "iPad (gen 7)",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 810,
      height: 1080,
    },
    viewport: {
      width: 810,
      height: 1080,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPad (gen 11)": {
    name: "iPad (gen 11)",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/19E241 Safari/604.1",
    screen: {
      width: 656,
      height: 944,
    },
    viewport: {
      width: 656,
      height: 944,
    },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPad Mini": {
    name: "iPad Mini",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 768,
      height: 1024,
    },
    viewport: {
      width: 768,
      height: 1024,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPad Pro 11": {
    name: "iPad Pro 11",
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 834,
      height: 1194,
    },
    viewport: {
      width: 834,
      height: 1194,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 6": {
    name: "iPhone 6",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.0 Mobile/15A372 Safari/604.1",
    screen: {
      width: 375,
      height: 667,
    },
    viewport: {
      width: 375,
      height: 667,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 6 Plus": {
    name: "iPhone 6 Plus",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.0 Mobile/15A372 Safari/604.1",
    screen: {
      width: 414,
      height: 736,
    },
    viewport: {
      width: 414,
      height: 736,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 7": {
    name: "iPhone 7",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.0 Mobile/15A372 Safari/604.1",
    screen: {
      width: 375,
      height: 667,
    },
    viewport: {
      width: 375,
      height: 667,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 7 Plus": {
    name: "iPhone 7 Plus",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.0 Mobile/15A372 Safari/604.1",
    screen: {
      width: 414,
      height: 736,
    },
    viewport: {
      width: 414,
      height: 736,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 8": {
    name: "iPhone 8",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.0 Mobile/15A372 Safari/604.1",
    screen: {
      width: 375,
      height: 667,
    },
    viewport: {
      width: 375,
      height: 667,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 8 Plus": {
    name: "iPhone 8 Plus",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.0 Mobile/15A372 Safari/604.1",
    screen: {
      width: 414,
      height: 736,
    },
    viewport: {
      width: 414,
      height: 736,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone SE": {
    name: "iPhone SE",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/26.0 Mobile/14E304 Safari/602.1",
    screen: {
      width: 320,
      height: 568,
    },
    viewport: {
      width: 320,
      height: 568,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone SE (3rd gen)": {
    name: "iPhone SE (3rd gen)",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/26.0 Mobile/19E241 Safari/602.1",
    screen: {
      width: 375,
      height: 667,
    },
    viewport: {
      width: 375,
      height: 667,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone X": {
    name: "iPhone X",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.0 Mobile/15A372 Safari/604.1",
    screen: {
      width: 375,
      height: 812,
    },
    viewport: {
      width: 375,
      height: 812,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone XR": {
    name: "iPhone XR",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 12_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 414,
      height: 896,
    },
    viewport: {
      width: 414,
      height: 896,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 11": {
    name: "iPhone 11",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 414,
      height: 896,
    },
    viewport: {
      width: 414,
      height: 715,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 11 Pro": {
    name: "iPhone 11 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 375,
      height: 812,
    },
    viewport: {
      width: 375,
      height: 635,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 11 Pro Max": {
    name: "iPhone 11 Pro Max",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 414,
      height: 896,
    },
    viewport: {
      width: 414,
      height: 715,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 12": {
    name: "iPhone 12",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 390,
      height: 844,
    },
    viewport: {
      width: 390,
      height: 664,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 12 Pro": {
    name: "iPhone 12 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 390,
      height: 844,
    },
    viewport: {
      width: 390,
      height: 664,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 12 Pro Max": {
    name: "iPhone 12 Pro Max",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 428,
      height: 926,
    },
    viewport: {
      width: 428,
      height: 746,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 12 Mini": {
    name: "iPhone 12 Mini",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 375,
      height: 812,
    },
    viewport: {
      width: 375,
      height: 629,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 13": {
    name: "iPhone 13",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 390,
      height: 844,
    },
    viewport: {
      width: 390,
      height: 664,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 13 Pro": {
    name: "iPhone 13 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 390,
      height: 844,
    },
    viewport: {
      width: 390,
      height: 664,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 13 Pro Max": {
    name: "iPhone 13 Pro Max",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 428,
      height: 926,
    },
    viewport: {
      width: 428,
      height: 746,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 13 Mini": {
    name: "iPhone 13 Mini",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 375,
      height: 812,
    },
    viewport: {
      width: 375,
      height: 629,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 14": {
    name: "iPhone 14",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 390,
      height: 844,
    },
    viewport: {
      width: 390,
      height: 664,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 14 Plus": {
    name: "iPhone 14 Plus",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 428,
      height: 926,
    },
    viewport: {
      width: 428,
      height: 746,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 14 Pro": {
    name: "iPhone 14 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 393,
      height: 852,
    },
    viewport: {
      width: 393,
      height: 660,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 14 Pro Max": {
    name: "iPhone 14 Pro Max",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 430,
      height: 932,
    },
    viewport: {
      width: 430,
      height: 740,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 15": {
    name: "iPhone 15",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 393,
      height: 852,
    },
    viewport: {
      width: 393,
      height: 659,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 15 Plus": {
    name: "iPhone 15 Plus",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 430,
      height: 932,
    },
    viewport: {
      width: 430,
      height: 739,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 15 Pro": {
    name: "iPhone 15 Pro",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 393,
      height: 852,
    },
    viewport: {
      width: 393,
      height: 659,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "iPhone 15 Pro Max": {
    name: "iPhone 15 Pro Max",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    screen: {
      width: 430,
      height: 932,
    },
    viewport: {
      width: 430,
      height: 739,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "Kindle Fire HDX": {
    name: "Kindle Fire HDX",
    userAgent:
      "Mozilla/5.0 (Linux; U; en-us; KFAPWI Build/JDQ39) AppleWebKit/535.19 (KHTML, like Gecko) Silk/3.13 Safari/535.19 Silk-Accelerated=true",
    screen: {
      width: 800,
      height: 1280,
    },
    viewport: {
      width: 800,
      height: 1280,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "LG Optimus L70": {
    name: "LG Optimus L70",
    userAgent:
      "Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; LGMS323 Build/KOT49I.MS32310c) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 384,
      height: 640,
    },
    viewport: {
      width: 384,
      height: 640,
    },
    deviceScaleFactor: 1.25,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Microsoft Lumia 550": {
    name: "Microsoft Lumia 550",
    userAgent:
      "Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 550) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36 Edge/14.14263",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Microsoft Lumia 950": {
    name: "Microsoft Lumia 950",
    userAgent:
      "Mozilla/5.0 (Windows Phone 10.0; Android 4.2.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36 Edge/14.14263",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 4,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nexus 10": {
    name: "Nexus 10",
    userAgent:
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 10 Build/MOB31T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 800,
      height: 1280,
    },
    viewport: {
      width: 800,
      height: 1280,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nexus 4": {
    name: "Nexus 4",
    userAgent:
      "Mozilla/5.0 (Linux; Android 4.4.2; Nexus 4 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 384,
      height: 640,
    },
    viewport: {
      width: 384,
      height: 640,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nexus 5": {
    name: "Nexus 5",
    userAgent:
      "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nexus 5X": {
    name: "Nexus 5X",
    userAgent:
      "Mozilla/5.0 (Linux; Android 8.0.0; Nexus 5X Build/OPR4.170623.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 412,
      height: 732,
    },
    viewport: {
      width: 412,
      height: 732,
    },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nexus 6": {
    name: "Nexus 6",
    userAgent:
      "Mozilla/5.0 (Linux; Android 7.1.1; Nexus 6 Build/N6F26U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 412,
      height: 732,
    },
    viewport: {
      width: 412,
      height: 732,
    },
    deviceScaleFactor: 3.5,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nexus 6P": {
    name: "Nexus 6P",
    userAgent:
      "Mozilla/5.0 (Linux; Android 8.0.0; Nexus 6P Build/OPP3.170518.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 412,
      height: 732,
    },
    viewport: {
      width: 412,
      height: 732,
    },
    deviceScaleFactor: 3.5,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nexus 7": {
    name: "Nexus 7",
    userAgent:
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 7 Build/MOB30X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 600,
      height: 960,
    },
    viewport: {
      width: 600,
      height: 960,
    },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nokia Lumia 520": {
    name: "Nokia Lumia 520",
    userAgent:
      "Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch; NOKIA; Lumia 520)",
    screen: {
      width: 320,
      height: 533,
    },
    viewport: {
      width: 320,
      height: 533,
    },
    deviceScaleFactor: 1.5,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Nokia N9": {
    name: "Nokia N9",
    userAgent:
      "Mozilla/5.0 (MeeGo; NokiaN9) AppleWebKit/534.13 (KHTML, like Gecko) NokiaBrowser/8.5.0 Mobile Safari/534.13",
    screen: {
      width: 480,
      height: 854,
    },
    viewport: {
      width: 480,
      height: 854,
    },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Webkit,
  },
  "Pixel 2": {
    name: "Pixel 2",
    userAgent:
      "Mozilla/5.0 (Linux; Android 8.0; Pixel 2 Build/OPD3.170816.012) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 411,
      height: 731,
    },
    viewport: {
      width: 411,
      height: 731,
    },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Pixel 2 XL": {
    name: "Pixel 2 XL",
    userAgent:
      "Mozilla/5.0 (Linux; Android 8.0.0; Pixel 2 XL Build/OPD1.170816.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 411,
      height: 823,
    },
    viewport: {
      width: 411,
      height: 823,
    },
    deviceScaleFactor: 3.5,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Pixel 3": {
    name: "Pixel 3",
    userAgent:
      "Mozilla/5.0 (Linux; Android 9; Pixel 3 Build/PQ1A.181105.017.A1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 393,
      height: 786,
    },
    viewport: {
      width: 393,
      height: 786,
    },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Pixel 4": {
    name: "Pixel 4",
    userAgent:
      "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 353,
      height: 745,
    },
    viewport: {
      width: 353,
      height: 745,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Pixel 4a (5G)": {
    name: "Pixel 4a (5G)",
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; Pixel 4a (5G)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 412,
      height: 892,
    },
    viewport: {
      width: 412,
      height: 765,
    },
    deviceScaleFactor: 2.63,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Pixel 5": {
    name: "Pixel 5",
    userAgent:
      "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 393,
      height: 851,
    },
    viewport: {
      width: 393,
      height: 727,
    },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Pixel 7": {
    name: "Pixel 7",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 412,
      height: 915,
    },
    viewport: {
      width: 412,
      height: 839,
    },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Moto G4": {
    name: "Moto G4",
    userAgent:
      "Mozilla/5.0 (Linux; Android 7.0; Moto G (4)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Mobile Safari/537.36",
    screen: {
      width: 360,
      height: 640,
    },
    viewport: {
      width: 360,
      height: 640,
    },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Desktop Chrome HiDPI": {
    name: "Desktop Chrome HiDPI",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 1792,
      height: 1120,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Desktop Edge HiDPI": {
    name: "Desktop Edge HiDPI",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36 Edg/141.0.7390.16",
    screen: {
      width: 1792,
      height: 1120,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Desktop Firefox HiDPI": {
    name: "Desktop Firefox HiDPI",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0.1) Gecko/20100101 Firefox/142.0.1",
    screen: {
      width: 1792,
      height: 1120,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Firefox,
  },
  "Desktop Safari": {
    name: "Desktop Safari",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    screen: {
      width: 1792,
      height: 1120,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Webkit,
  },
  "Desktop Chrome": {
    name: "Desktop Chrome",
    displayName: "Playwright Chromium",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 1920,
      height: 1080,
    },
    viewport: {
      width: 1920,
      height: 1080,
    },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Desktop Chrome Medium Resolution": {
    name: "Desktop Chrome Medium Resolution",
    displayName: "Playwright Chromium",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 1280,
      height: 720,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Desktop Chrome (Branded)": {
    name: "Desktop Chrome (Branded)",
    displayName: "Google Chrome",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 1920,
      height: 1080,
    },
    viewport: {
      width: 1920,
      height: 1080,
    },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
    channel: "chrome",
  },
  "Desktop Chrome Medium Resolution (Branded)": {
    name: "Desktop Chrome Medium Resolution (Branded)",
    displayName: "Google Chrome",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36",
    screen: {
      width: 1280,
      height: 720,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
    channel: "chrome",
  },
  "Desktop Edge": {
    name: "Desktop Edge",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36 Edg/141.0.7390.16",
    screen: {
      width: 1920,
      height: 1080,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
  },
  "Desktop Edge (Branded)": {
    name: "Desktop Edge (Branded)",
    displayName: "Microsoft Edge",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36 Edg/141.0.7390.16",
    screen: {
      width: 1920,
      height: 1080,
    },
    viewport: {
      width: 1920,
      height: 1080,
    },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
    channel: "msedge",
  },
  "Desktop Edge Medium Resolution (Branded)": {
    name: "Desktop Edge Medium Resolution (Branded)",
    displayName: "Microsoft Edge",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.16 Safari/537.36 Edg/141.0.7390.16",
    screen: {
      width: 1280,
      height: 720,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Chromium,
    channel: "msedge",
  },
  "Desktop Firefox": {
    name: "Desktop Firefox",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0.1) Gecko/20100101 Firefox/142.0.1",
    screen: {
      width: 1920,
      height: 1080,
    },
    viewport: {
      width: 1280,
      height: 720,
    },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    defaultBrowserType: BrowserType.Firefox,
  },
};

// 设备类型分类
export enum DeviceType {
  Desktop = "desktop",
  // Tablet = "tablet",
  Mobile = "mobile",
}

export const DEVICE_CATEGORIES = {
  [DeviceType.Desktop]: [
    "Desktop Chrome",
    "Desktop Chrome Medium Resolution",
    "Desktop Chrome (Branded)",
    "Desktop Chrome Medium Resolution (Branded)",
    "Desktop Edge (Branded)",
    "Desktop Edge Medium Resolution (Branded)",
    "Desktop Safari",
    // "Desktop Edge",
    // "Desktop Firefox",
    // "Desktop Chrome HiDPI",
    // "Desktop Edge HiDPI",
    // "Desktop Firefox HiDPI"
  ],
  //   [DeviceType.Tablet]: [
  //     "iPad Pro 11",
  //     "iPad (gen 11)",
  //     "iPad (gen 7)",
  //     "iPad (gen 6)",
  //     "iPad (gen 5)",
  //     "iPad Mini",
  //     "Galaxy Tab S9",
  //     "Galaxy Tab S4",
  //     "Nexus 10",
  //     "Nexus 7",
  //     "Kindle Fire HDX",
  //     "Blackberry PlayBook"
  // ],
  [DeviceType.Mobile]: [
    "iPhone 15 Pro Max",
    "iPhone 15 Pro",
    "iPhone 15 Plus",
    "iPhone 15",
    "iPhone 14 Pro Max",
    "iPhone 14 Pro",
    "iPhone 14 Plus",
    "iPhone 14",
    "iPhone 13 Pro Max",
    "iPhone 13 Pro",
    "iPhone 13",
    "iPhone 13 Mini",
    "iPhone 12 Pro Max",
    "iPhone 12 Pro",
    "iPhone 12",
    "iPhone 12 Mini",
    "iPhone 11 Pro Max",
    "iPhone 11 Pro",
    "iPhone 11",
    "iPhone XR",
    "iPhone X",
    "iPhone SE (3rd gen)",
    "iPhone SE",
    "iPhone 8 Plus",
    "iPhone 8",
    "iPhone 7 Plus",
    "iPhone 7",
    "iPhone 6 Plus",
    "iPhone 6",
    "Galaxy S24",
    "Galaxy A55",
    "Galaxy S9+",
    "Galaxy S8",
    "Galaxy S5",
    "Galaxy Note 3",
    "Galaxy Note II",
    "Galaxy S III",
    "Pixel 7",
    "Pixel 5",
    "Pixel 4a (5G)",
    "Pixel 4",
    "Pixel 3",
    "Pixel 2 XL",
    "Pixel 2",
    "Nexus 6P",
    "Nexus 6",
    "Nexus 5X",
    "Nexus 5",
    "Nexus 4",
    "Moto G4",
    "LG Optimus L70",
    "Microsoft Lumia 950",
    "Microsoft Lumia 550",
    "Nokia Lumia 520",
    "Nokia N9",
    "BlackBerry Z30",
  ],
};

export const getDevicesByCategory = (category: DeviceType, includeWebkit: boolean = false): PlaywrightDevice[] => {
  const allowedBrowserTypes = [BrowserType.Chromium];
  if (includeWebkit) {
    allowedBrowserTypes.push(BrowserType.Webkit);
  }
  return DEVICE_CATEGORIES[category]
    .map((deviceName) => PLAYWRIGHT_DEVICES[deviceName])
    .filter((device) => device.defaultBrowserType && allowedBrowserTypes.includes(device.defaultBrowserType));
};

export const getAllDeviceNames = (): string[] => {
  return Object.keys(PLAYWRIGHT_DEVICES);
};

export const getDeviceByName = (name: string): PlaywrightDevice | undefined => {
  return PLAYWRIGHT_DEVICES[name];
};

export const UI_DEVICE_CATEGORIES = {
  desktop: {
    label: "Desktop",
    type: DeviceType.Desktop,
    devices: getDevicesByCategory(DeviceType.Desktop),
  },
  // tablet: {
  //   label: "Tablet",
  //   type: DeviceType.Tablet,
  //   devices: getDevicesByCategory(DeviceType.Tablet)
  // },
  mobile: {
    label: "Mobile Web",
    type: DeviceType.Mobile,
    devices: getDevicesByCategory(DeviceType.Mobile),
  },
};

/**
 * Device categories for electron app (includes Webkit/Safari browsers)
 * Use this in the Electron app where Safari is supported locally
 */
export const UI_DEVICE_CATEGORIES_ELECTRON = {
  desktop: {
    label: "Desktop",
    type: DeviceType.Desktop,
    devices: getDevicesByCategory(DeviceType.Desktop, true),
  },
  mobile: {
    label: "Mobile Web",
    type: DeviceType.Mobile,
    devices: getDevicesByCategory(DeviceType.Mobile, true),
  },
};

// ============================================================================
// Device utility functions
// ============================================================================

/**
 * Get device options for browser context creation
 */
export const getDeviceOptions = (deviceName?: string, withScale: boolean = false) => {
  const defaultDeviceOptions = {
    userAgent: USER_AGENT,
    viewport: {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT
    },
    isMobile: false,
    hasTouch: false,
  };

  if (!deviceName || deviceName === DEFAULT_DEVICE_NAME) {
    return defaultDeviceOptions;
  }

  const originalDeviceOptions = getDeviceByName(deviceName);
  if (!originalDeviceOptions) {
    return defaultDeviceOptions;
  }

  const { width: originalViewportWidth, height: originalViewportHeight } = originalDeviceOptions.viewport;
  const widthScale = Math.max(MIN_WINDOW_WIDTH / originalViewportWidth, 1);
  const heightScale = Math.max(MIN_WINDOW_HEIGHT / originalViewportHeight, 1);
  const scale = Math.max(widthScale, heightScale);
  const viewport = {
    width: Math.round(originalViewportWidth * scale),
    height: Math.round(originalViewportHeight * scale),
  };

  const deviceOptions = {
    userAgent: originalDeviceOptions.userAgent,
    viewport: withScale ? viewport : originalDeviceOptions.viewport,
    isMobile: originalDeviceOptions.isMobile,
    hasTouch: originalDeviceOptions.hasTouch,
  };
  return deviceOptions;
};

/**
 * Get browser window size for a device
 */
export const getBrowserWindowSize = (deviceName?: string) => {
  const defaultWindowSize = {
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT
  };

  if (!deviceName || deviceName === DEFAULT_DEVICE_NAME) {
    return defaultWindowSize;
  }

  const deviceOptions = getDeviceOptions(deviceName);
  if (!deviceOptions.viewport) {
    return defaultWindowSize;
  }

  return {
    width: deviceOptions.viewport.width,
    height: deviceOptions.viewport.height + ADDRESS_BAR_HEIGHT
  };
};

/**
 * Get video recording size for a device
 */
export const getRecordVideoSize = (deviceName?: string) => {
  const defaultRecordVideoSize = {
    width: RECORD_VIDEO_WIDTH,
    height: RECORD_VIDEO_HEIGHT
  };

  if (!deviceName || deviceName === DEFAULT_DEVICE_NAME) {
    return defaultRecordVideoSize;
  }

  const deviceOptions = getDeviceOptions(deviceName);
  if (!deviceOptions.viewport) {
    return defaultRecordVideoSize;
  }

  return {
    width: deviceOptions.viewport.width,
    height: deviceOptions.viewport.height
  };
};

/**
 * Get browser channel for branded browsers (Chrome, Edge)
 */
export const getDeviceChannel = (deviceName?: string): "chrome" | "msedge" | "chrome-beta" | "msedge-beta" | "msedge-dev" | undefined => {
  if (!deviceName || deviceName === DEFAULT_DEVICE_NAME) {
    return undefined;
  }

  const device = getDeviceByName(deviceName);
  return device?.channel;
};

/**
 * Get browser type for a device (chromium, firefox, webkit)
 * Defaults to chromium if device not found or no browser type specified
 */
export const getDeviceBrowserType = (deviceName?: string): BrowserType => {
  if (!deviceName || deviceName === DEFAULT_DEVICE_NAME) {
    return BrowserType.Chromium;
  }

  const device = getDeviceByName(deviceName);
  return device?.defaultBrowserType ?? BrowserType.Chromium;
};
