import * as Linking from "expo-linking";
import Constants from "expo-constants";
import * as ReactNative from "react-native";

// Extract scheme from bundle ID (last segment timestamp, prefixed with "manus")
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const bundleId = "space.manus.recoder.t247775881893843";
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

const env = {
  portal: extra.oauthPortalUrl ?? process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL ?? "",
  server: extra.oauthServerUrl ?? process.env.EXPO_PUBLIC_OAUTH_SERVER_URL ?? "",
  appId: extra.appId ?? process.env.EXPO_PUBLIC_APP_ID ?? "",
  ownerId: process.env.EXPO_PUBLIC_OWNER_OPEN_ID ?? "",
  ownerName: process.env.EXPO_PUBLIC_OWNER_NAME ?? "",
  // NOTE: `||` not `??` — app.config.ts always serializes `apiBaseUrl` into
  // `extra`, defaulting to "". With `??` that empty string is not nullish, so
  // it would win and the EXPO_PUBLIC_API_BASE_URL fallback would never apply.
  apiBaseUrl: extra.apiBaseUrl || process.env.EXPO_PUBLIC_API_BASE_URL || "",
  deepLinkScheme: schemeFromBundleId,
};

export const OAUTH_PORTAL_URL = env.portal;
export const OAUTH_SERVER_URL = env.server;
export const APP_ID = env.appId;
export const OWNER_OPEN_ID = env.ownerId;
export const OWNER_NAME = env.ownerName;
export const API_BASE_URL = env.apiBaseUrl;

/**
 * Whether an explicit API origin was supplied at build time.
 *
 * `EXPO_PUBLIC_API_BASE_URL` is inlined by Metro during bundling, so it must be
 * set BEFORE `expo export` runs. Setting it at runtime has no effect on an
 * already-exported bundle.
 */
export const IS_API_BASE_CONFIGURED = Boolean(API_BASE_URL);

/** Raised when a request is attempted with no usable API origin. */
export class ApiBaseUrlMissingError extends Error {
  constructor() {
    super(
      "EXPO_PUBLIC_API_BASE_URL is not set, so the client has no tRPC server to reach. " +
        "Set it before building, e.g. " +
        "EXPO_PUBLIC_API_BASE_URL=https://your-server.example.com npx expo export --platform web",
    );
    this.name = "ApiBaseUrlMissingError";
  }
}

/**
 * Human-readable description of where API requests will go.
 * Used for startup diagnostics so a misconfigured build is obvious rather than
 * silently issuing requests against the static host.
 */
export function describeApiBase(): string {
  const resolved = getApiBaseUrl();
  if (IS_API_BASE_CONFIGURED) return `configured: ${resolved}`;
  if (resolved) return `derived from hostname: ${resolved}`;
  return "unset — requests would target the static host and 404";
}

/**
 * Get the API base URL, deriving from current hostname if not set.
 * Metro runs on 8081, API server runs on 3000.
 * URL pattern: https://PORT-sandboxid.region.domain
 */
export function getApiBaseUrl(): string {
  // If API_BASE_URL is set, use it
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/\/$/, "");
  }

  // On web, derive from current hostname by replacing port 8081 with 3000
  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    // Pattern: 8081-sandboxid.region.domain -> 3000-sandboxid.region.domain
    const apiHostname = hostname.replace(/^8081-/, "3000-");
    if (apiHostname !== hostname) {
      return `${protocol}//${apiHostname}`;
    }
  }

  // Fallback to empty (will use relative URL)
  return "";
}

/**
 * Resolve the API origin, or throw with an actionable message.
 *
 * Prefer this over `getApiBaseUrl()` on any path that is about to perform a
 * network request: an empty base silently resolves to the static host and
 * surfaces as an opaque 404 instead of a configuration error.
 */
export function requireApiBaseUrl(): string {
  const resolved = getApiBaseUrl();
  if (!resolved) throw new ApiBaseUrlMissingError();
  return resolved;
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";

const encodeState = (value: string) => {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  const BufferImpl = (globalThis as Record<string, any>).Buffer;
  if (BufferImpl) {
    return BufferImpl.from(value, "utf-8").toString("base64");
  }
  return value;
};

/**
 * Get the redirect URI for OAuth callback.
 * - Web: uses API server callback endpoint
 * - Native: uses deep link scheme
 */
export const getRedirectUri = () => {
  if (ReactNative.Platform.OS === "web") {
    return `${getApiBaseUrl()}/api/oauth/callback`;
  } else {
    return Linking.createURL("/oauth/callback", {
      scheme: env.deepLinkScheme,
    });
  }
};

export const getLoginUrl = () => {
  if (!OAUTH_PORTAL_URL || !APP_ID) {
    throw new Error("Manus login configuration is unavailable");
  }
  const redirectUri = getRedirectUri();
  const state = encodeState(redirectUri);

  const url = new URL(`${OAUTH_PORTAL_URL}/app-auth`);
  url.searchParams.set("appId", APP_ID);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

/**
 * Start OAuth login flow.
 *
 * On native platforms (iOS/Android), open the system browser directly so
 * the OAuth callback returns via deep link to the app.
 *
 * On web, this simply redirects to the login URL.
 *
 * @returns Always null, the callback is handled via deep link.
 */
export async function startOAuthLogin(): Promise<string | null> {
  const loginUrl = getLoginUrl();

  if (ReactNative.Platform.OS === "web") {
    // On web, just redirect
    if (typeof window !== "undefined") {
      window.location.href = loginUrl;
    }
    return null;
  }

  const supported = await Linking.canOpenURL(loginUrl);
  if (!supported) {
    console.warn("[OAuth] Cannot open login URL: URL scheme not supported");
    return null;
  }

  try {
    await Linking.openURL(loginUrl);
  } catch {
    console.error("[OAuth] Failed to open login URL");
  }

  // The OAuth callback will reopen the app via deep link.
  return null;
}
