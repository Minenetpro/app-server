import { hostname, platform, arch } from "node:os";
import { randomHex } from "./hash";
import { createApiClient, ApiError } from "./api";
import {
  loadState,
  saveDaemonInfo,
  saveState,
} from "./paths";
import { deployWorkspace, getRunStatus, pullWorkspace, pushWorkspace, workspaceStatus } from "./workspace";
import type { JsonObject, LocalState, StoredProfile } from "./types";

const DEFAULT_API_BASE_URL =
  (process.env.MINENET_API_BASE_URL || "https://www.minenet.pro").replace(/\/+$/, "");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_API_BASE_URL;
  }
  return value.trim().replace(/\/+$/, "");
}

async function parseJson(req: Request): Promise<JsonObject> {
  const payload = await req.json().catch(() => ({}));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as JsonObject;
}

function getCurrentProfile(state: LocalState): StoredProfile | null {
  if (!state.currentTeamId) {
    return null;
  }
  return state.profiles[state.currentTeamId] ?? null;
}

function serializeProfile(profile: StoredProfile | null) {
  if (!profile) {
    return null;
  }

  return {
    team_id: profile.teamId,
    team_slug: profile.teamSlug,
    team_name: profile.teamName,
    token_name: profile.tokenName,
    created_at: profile.createdAt,
    api_base_url: profile.apiBaseUrl,
  };
}

function isAuthorized(req: Request, daemonToken: string): boolean {
  const supplied = req.headers.get("x-minenet-daemon-token");
  return supplied === daemonToken;
}

function handleError(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(
      {
        error: error.message,
        code: error.code,
        details: error.details,
        retry_after: error.retryAfterSeconds,
      },
      error.status,
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  return jsonResponse({ error: message }, 500);
}

export async function startServer() {
  const daemonToken = randomHex(32);
  const startedAt = Date.now();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number.parseInt(process.env.MINENET_DAEMON_PORT || "0", 10) || 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname === "/v1/health" && req.method === "GET") {
        return jsonResponse({
          ok: true,
          pid: process.pid,
          started_at: startedAt,
        });
      }

      if (!isAuthorized(req, daemonToken)) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }

      try {
        if (pathname === "/v1/auth/status" && req.method === "GET") {
          const state = await loadState();
          return jsonResponse({
            authenticated: Boolean(getCurrentProfile(state)),
            profile: serializeProfile(getCurrentProfile(state)),
          });
        }

        if (pathname === "/v1/teams/current" && req.method === "GET") {
          const state = await loadState();
          const profile = getCurrentProfile(state);
          if (!profile) {
            return jsonResponse({ error: "Not logged in" }, 401);
          }
          return jsonResponse({
            team_id: profile.teamId,
            team_slug: profile.teamSlug,
            team_name: profile.teamName,
          });
        }

        if (pathname === "/v1/auth/logout" && req.method === "POST") {
          const body = await parseJson(req);
          const state = await loadState();

          const teamId = typeof body.teamId === "string" ? body.teamId : state.currentTeamId;
          if (teamId && state.profiles[teamId]) {
            delete state.profiles[teamId];
          }

          state.currentTeamId = null;
          await saveState(state);

          return jsonResponse({ ok: true });
        }

        if (pathname === "/v1/auth/login/start" && req.method === "POST") {
          const body = await parseJson(req);
          const apiBaseUrl = normalizeBaseUrl(body.apiBaseUrl);
          const client = createApiClient(apiBaseUrl, "");

          const response = await client.startDeviceLogin({
            deviceName:
              typeof body.deviceName === "string" && body.deviceName.trim()
                ? body.deviceName.trim()
                : "minenet-cli",
            os: typeof body.os === "string" ? body.os : platform(),
            arch: typeof body.arch === "string" ? body.arch : arch(),
            hostname:
              typeof body.hostname === "string" && body.hostname.trim()
                ? body.hostname.trim()
                : hostname(),
            cliVersion: typeof body.cliVersion === "string" ? body.cliVersion : "dev",
          });

          return jsonResponse({
            ok: true,
            api_base_url: apiBaseUrl,
            ...response,
          });
        }

        if (pathname === "/v1/auth/login/poll" && req.method === "POST") {
          const body = await parseJson(req);
          const apiBaseUrl = normalizeBaseUrl(body.apiBaseUrl);
          const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";

          if (!deviceCode) {
            return jsonResponse({ error: "deviceCode is required" }, 400);
          }

          const client = createApiClient(apiBaseUrl, "");
          const poll = await client.pollDeviceLogin(deviceCode);

          if ("access_token" in poll) {
            const state = await loadState();
            const teamId = poll.team_id;
            const profile: StoredProfile = {
              teamId,
              teamSlug: poll.team_slug || teamId,
              teamName: poll.team_name || poll.team_slug || teamId,
              token: poll.access_token,
              tokenName: poll.token_name || "CLI token",
              createdAt: poll.created_at || Date.now(),
              apiBaseUrl,
            };

            state.profiles[teamId] = profile;
            state.currentTeamId = teamId;
            await saveState(state);

            return jsonResponse({
              ok: true,
              authenticated: true,
              profile: serializeProfile(profile),
            });
          }

          return jsonResponse({
            ok: false,
            authenticated: false,
            ...poll,
          });
        }

        if (pathname === "/v1/workspace/pull" && req.method === "POST") {
          const body = await parseJson(req);
          const state = await loadState();
          const profile = getCurrentProfile(state);
          if (!profile) {
            return jsonResponse({ error: "Not logged in" }, 401);
          }

          const result = await pullWorkspace({
            profile,
            cwd: typeof body.cwd === "string" ? body.cwd : process.cwd(),
            workspacePath:
              typeof body.workspacePath === "string" ? body.workspacePath : undefined,
            force: Boolean(body.force),
          });

          if (!result.ok) {
            return jsonResponse(result, 409);
          }

          return jsonResponse(result);
        }

        if (pathname === "/v1/workspace/push" && req.method === "POST") {
          const body = await parseJson(req);
          const state = await loadState();
          const profile = getCurrentProfile(state);
          if (!profile) {
            return jsonResponse({ error: "Not logged in" }, 401);
          }

          const result = await pushWorkspace({
            profile,
            cwd: typeof body.cwd === "string" ? body.cwd : process.cwd(),
            workspacePath:
              typeof body.workspacePath === "string" ? body.workspacePath : undefined,
            selector: typeof body.selector === "string" ? body.selector : undefined,
            force: Boolean(body.force),
          });

          if (!result.ok) {
            return jsonResponse(result, 409);
          }

          return jsonResponse(result);
        }

        if (pathname === "/v1/workspace/deploy" && req.method === "POST") {
          const body = await parseJson(req);
          const state = await loadState();
          const profile = getCurrentProfile(state);
          if (!profile) {
            return jsonResponse({ error: "Not logged in" }, 401);
          }

          const result = await deployWorkspace({
            profile,
            cwd: typeof body.cwd === "string" ? body.cwd : process.cwd(),
            workspacePath:
              typeof body.workspacePath === "string" ? body.workspacePath : undefined,
            selector: typeof body.selector === "string" ? body.selector : undefined,
          });

          return jsonResponse(result);
        }

        if (pathname === "/v1/workspace/status" && req.method === "POST") {
          const body = await parseJson(req);
          const state = await loadState();
          const profile = getCurrentProfile(state);
          if (!profile) {
            return jsonResponse({ error: "Not logged in" }, 401);
          }

          const status = await workspaceStatus({
            profile,
            cwd: typeof body.cwd === "string" ? body.cwd : process.cwd(),
            workspacePath:
              typeof body.workspacePath === "string" ? body.workspacePath : undefined,
          });

          return jsonResponse(status);
        }

        if (pathname.startsWith("/v1/deploy/runs/") && req.method === "GET") {
          const runId = decodeURIComponent(pathname.slice("/v1/deploy/runs/".length));
          if (!runId) {
            return jsonResponse({ error: "runId is required" }, 400);
          }

          const state = await loadState();
          const profile = getCurrentProfile(state);
          if (!profile) {
            return jsonResponse({ error: "Not logged in" }, 401);
          }

          const result = await getRunStatus({
            profile,
            runId,
          });

          return jsonResponse(result);
        }

        return jsonResponse({ error: "Not found" }, 404);
      } catch (error) {
        return handleError(error);
      }
    },
  });

  const port = server.port ?? 0;

  await saveDaemonInfo({
    version: 1,
    port,
    token: daemonToken,
    pid: process.pid,
    startedAt,
  });

  return server;
}
