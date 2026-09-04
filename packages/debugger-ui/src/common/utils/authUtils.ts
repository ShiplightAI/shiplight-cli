// utils/auth/authUtils.ts
export function parseAuthTokenFromCookie(
  cookieValue: string | undefined,
): string | null {
  if (!cookieValue) return null;

  try {
    const decoded = Buffer.from(
      cookieValue.replace("base64-", ""),
      "base64",
    ).toString();
    const tokenData = JSON.parse(decoded);
    return tokenData.access_token || null;
  } catch (error) {
    console.error("Error parsing auth cookie:", error);
    return null;
  }
}

export function getAuthCookieFromCookies(
  cookies: any,
  baseCookieName: string,
): string | null {
  const completeToken = cookies[baseCookieName];
  if (completeToken) {
    return completeToken.replace("base64-", "");
  }
  const cookieKeys = Object.keys(cookies)
  .filter((key) => key.startsWith(baseCookieName + "."))
  .sort((a, b) => {
    const numA = parseInt(a.split(".").pop() || "0");
    const numB = parseInt(b.split(".").pop() || "0");
    return numA - numB;
  });
  if (cookieKeys.length > 0) {
    const combinedToken = cookieKeys.map((key) => cookies[key]).join("");
    return combinedToken.replace("base64-", "");
  }
  return null;
}

// Helper function to get and parse auth token from cookies
export function getAuthTokenFromCookies(
  cookies: any,
  baseCookieName: string,
): string | null {
  // Try to get the complete token first (email login case)
  const completeToken = cookies[baseCookieName];
  if (completeToken) {
    return parseAuthTokenFromCookie(completeToken);
  }

  // For Google login, find all related cookie parts
  const cookieKeys = Object.keys(cookies)
    .filter((key) => key.startsWith(baseCookieName + "."))
    .sort((a, b) => {
      const numA = parseInt(a.split(".").pop() || "0");
      const numB = parseInt(b.split(".").pop() || "0");
      return numA - numB;
    });

  // If we found cookie parts, combine them in order
  if (cookieKeys.length > 0) {
    const combinedToken = cookieKeys.map((key) => cookies[key]).join("");
    return parseAuthTokenFromCookie(combinedToken);
  }

  return null;
}

export function clearAuthTokens(cookies: any,baseCookieName: string, res: any) {
  const cookieNamesToClear: string[] = []
  const completeToken = cookies[baseCookieName];
  if (completeToken) {
    cookieNamesToClear.push(baseCookieName);
  } else {
    const cookieKeys = Object.keys(cookies)
      .filter((key) => key.startsWith(baseCookieName + "."))
      .sort((a, b) => {
        const numA = parseInt(a.split(".").pop() || "0");
        const numB = parseInt(b.split(".").pop() || "0");
        return numA - numB;
      });
    cookieNamesToClear.push(...cookieKeys);
  }
  cookieNamesToClear.forEach((cookieName) => {
    res.setHeader("Set-Cookie", `${cookieName}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`);
  });
}