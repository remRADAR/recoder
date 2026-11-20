import { AXIOS_TIMEOUT_MS, ONE_YEAR_MS } from "../../shared/const.js";
import { ForbiddenError } from "../../shared/_core/errors.js";
import axios, { type AxiosInstance } from "axios";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { currentSessionCookie } from "./cookies";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const LAST_SIGNED_IN_INTERVAL_MS = 60_000;
const LAST_SIGNED_IN_ENTRY_TTL_MS = 120_000;
const MAX_LAST_SIGNED_IN_ENTRIES = 10_000;

type ThrottleEntry = { at: number; token: symbol; inFlight: boolean };

export function shouldWriteLastSignedIn(lastWriteAt: number | undefined, now: number): boolean {
  return lastWriteAt === undefined || now - lastWriteAt >= LAST_SIGNED_IN_INTERVAL_MS;
}

export class LastSignedInThrottle {
  private readonly entries = new Map<string, ThrottleEntry>();
  private operations = 0;

  reserve(openId: string, now = Date.now()): symbol | null {
    this.operations += 1;
    this.prune(now);
    const existing = this.entries.get(openId);
    if (existing && (existing.inFlight || !shouldWriteLastSignedIn(existing.at, now))) return null;
    if (!existing && this.entries.size >= MAX_LAST_SIGNED_IN_ENTRIES) {
      this.prune(now, true);
      if (this.entries.size >= MAX_LAST_SIGNED_IN_ENTRIES) return null;
    }
    const token = Symbol(openId);
    this.entries.set(openId, { at: now, token, inFlight: true });
    return token;
  }

  complete(openId: string, token: symbol) {
    const entry = this.entries.get(openId);
    if (entry?.token === token) entry.inFlight = false;
  }

  fail(openId: string, token: symbol) {
    const entry = this.entries.get(openId);
    if (entry?.token === token) this.entries.delete(openId);
  }

  size() {
    return this.entries.size;
  }

  private prune(now: number, force = false) {
    if (!force && this.operations % 64 !== 0 && this.entries.size <= MAX_LAST_SIGNED_IN_ENTRIES) return;
    for (const [openId, entry] of this.entries) {
      if (!entry.inFlight && now - entry.at >= LAST_SIGNED_IN_ENTRY_TTL_MS) this.entries.delete(openId);
    }
    if (this.entries.size <= MAX_LAST_SIGNED_IN_ENTRIES) return;
    const inactive = [...this.entries.entries()].filter(([, entry]) => !entry.inFlight).sort(([, left], [, right]) => left.at - right.at);
    for (const [openId] of inactive) {
      if (this.entries.size <= MAX_LAST_SIGNED_IN_ENTRIES) break;
      this.entries.delete(openId);
    }
  }
}

export type SessionPayload = { openId: string; appId: string; name: string };

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    console.log("[OAuth] Client initialized");
    if (!ENV.oAuthServerUrl) console.error("[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.");
  }
  private decodeState(state: string): string { return atob(state); }
  async getTokenByCode(code: string, state: string): Promise<ExchangeTokenResponse> {
    return (await this.client.post<ExchangeTokenResponse>(EXCHANGE_TOKEN_PATH, { clientId: ENV.appId, grantType: "authorization_code", code, redirectUri: this.decodeState(state) })).data;
  }
  async getUserInfoByToken(token: ExchangeTokenResponse): Promise<GetUserInfoResponse> {
    return (await this.client.post<GetUserInfoResponse>(GET_USER_INFO_PATH, { accessToken: token.accessToken })).data;
  }
}

const createOAuthHttpClient = (): AxiosInstance => axios.create({ baseURL: ENV.oAuthServerUrl, timeout: AXIOS_TIMEOUT_MS });

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;
  private readonly lastSignedInWrite = new LastSignedInThrottle();

  constructor(client: AxiosInstance = createOAuthHttpClient()) { this.client = client; this.oauthService = new OAuthService(this.client); }

  private deriveLoginMethod(platforms: unknown, fallback: string | null | undefined): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(platforms.filter((p): p is string => typeof p === "string"));
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE")) return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  async exchangeCodeForToken(code: string, state: string): Promise<ExchangeTokenResponse> { return this.oauthService.getTokenByCode(code, state); }
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({ accessToken } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod((data as any)?.platforms, (data as any)?.platform ?? data.platform ?? null);
    return { ...(data as any), platform: loginMethod, loginMethod } as GetUserInfoResponse;
  }
  private getSessionSecret() { return new TextEncoder().encode(ENV.cookieSecret); }
  async createSessionToken(openId: string, options: { expiresInMs?: number; name?: string } = {}): Promise<string> { return this.signSession({ openId, appId: ENV.appId, name: options.name || "" }, options); }
  async signSession(payload: SessionPayload, options: { expiresInMs?: number } = {}): Promise<string> {
    const issuedAt = Date.now();
    return new SignJWT({ openId: payload.openId, appId: payload.appId, name: payload.name }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(Math.floor((issuedAt + (options.expiresInMs ?? ONE_YEAR_MS)) / 1000)).sign(this.getSessionSecret());
  }
  async verifySession(cookieValue: string | undefined | null): Promise<{ openId: string; appId: string; name: string } | null> {
    if (!cookieValue) { console.warn("[Auth] Missing session cookie"); return null; }
    try {
      const { payload } = await jwtVerify(cookieValue, this.getSessionSecret(), { algorithms: ["HS256"] });
      const { openId, appId, name } = payload as Record<string, unknown>;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) return null;
      return { openId, appId, name };
    } catch { console.warn("[Auth] Session verification failed"); return null; }
  }
  async getUserInfoWithJwt(jwtToken: string): Promise<GetUserInfoWithJwtResponse> {
    const data = (await this.client.post<GetUserInfoWithJwtResponse>(GET_USER_INFO_WITH_JWT_PATH, { jwtToken, projectId: ENV.appId })).data;
    const loginMethod = this.deriveLoginMethod((data as any)?.platforms, (data as any)?.platform ?? data.platform ?? null);
    return { ...(data as any), platform: loginMethod, loginMethod } as GetUserInfoWithJwtResponse;
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : undefined;
    const sessionCookie = token || currentSessionCookie(req);
    const session = await this.verifySession(sessionCookie);
    if (!session) throw ForbiddenError("Invalid session cookie");
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
      if (!userInfo.taskUid) throw ForbiddenError("Cron session missing task_uid");
      return buildCronUser(userInfo);
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user = await db.getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await db.upsertUser({ openId: userInfo.openId, name: userInfo.name || null, email: userInfo.email ?? null, loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null, lastSignedIn: signedInAt });
        user = await db.getUserByOpenId(userInfo.openId);
      } catch {
        console.error("[Auth] Failed to sync user from OAuth");
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) throw ForbiddenError("User not found");

    const reservation = this.lastSignedInWrite.reserve(user.openId, signedInAt.getTime());
    if (reservation) {
      try {
        await db.upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
        this.lastSignedInWrite.complete(user.openId, reservation);
      } catch (error) {
        this.lastSignedInWrite.fail(user.openId, reservation);
        throw error;
      }
    }
    return user;
  }
}

const CRON_OPEN_ID_PREFIX = "cron_";
export type AuthenticatedUser = User & { taskUid?: string; isCron?: boolean };
function buildCronUser(userInfo: GetUserInfoWithJwtResponse): AuthenticatedUser {
  const now = new Date();
  return { id: -1, openId: userInfo.openId, name: userInfo.name || "Manus Scheduled Task", email: null, loginMethod: null, role: "user", createdAt: now, updatedAt: now, lastSignedIn: now, taskUid: userInfo.taskUid ?? undefined, isCron: true } as AuthenticatedUser;
}
export const sdk = new SDKServer();
