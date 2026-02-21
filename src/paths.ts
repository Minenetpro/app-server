import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DaemonInfo, LocalState, WorkspaceManifest } from "./types";

const APP_NAME = "minenet";

const DEFAULT_STATE: LocalState = {
  version: 1,
  currentTeamId: null,
  profiles: {},
};

function normalizeDir(path: string): string {
  return path.replace(/\\+/g, "/");
}

export function getConfigDir(): string {
  const home = homedir();

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return normalizeDir(join(appData, APP_NAME));
  }

  if (process.platform === "darwin") {
    return normalizeDir(join(home, "Library", "Application Support", APP_NAME));
  }

  const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
  return normalizeDir(join(xdg, APP_NAME));
}

export function getLegacyConfigDir(): string {
  return normalizeDir(join(homedir(), `.${APP_NAME}`));
}

export function getStatePath(): string {
  return join(getConfigDir(), "state.json");
}

export function getDaemonInfoPath(): string {
  return join(getConfigDir(), "daemon.json");
}

export function getLogsDir(): string {
  return join(getConfigDir(), "logs");
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  if (process.platform !== "win32") {
    try {
      await chmod(path, 0o700);
    } catch {
      // best effort
    }
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;

  await writeFile(tmpPath, payload, "utf8");
  if (process.platform !== "win32") {
    try {
      await chmod(tmpPath, 0o600);
    } catch {
      // best effort
    }
  }

  await rename(tmpPath, path);

  if (process.platform !== "win32") {
    try {
      await chmod(path, 0o600);
    } catch {
      // best effort
    }
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function importLegacyStateIfPresent(): Promise<void> {
  const statePath = getStatePath();
  if (existsSync(statePath)) {
    return;
  }

  const legacyState = join(getLegacyConfigDir(), "state.json");
  if (!existsSync(legacyState)) {
    return;
  }

  const parsed = await readJsonFile<LocalState>(legacyState);
  if (!parsed) {
    return;
  }

  await saveState(parsed);
}

export async function loadState(): Promise<LocalState> {
  await importLegacyStateIfPresent();
  const parsed = await readJsonFile<LocalState>(getStatePath());
  if (!parsed || parsed.version !== 1 || typeof parsed.profiles !== "object") {
    return structuredClone(DEFAULT_STATE);
  }

  return {
    version: 1,
    currentTeamId: parsed.currentTeamId ?? null,
    profiles: parsed.profiles ?? {},
  };
}

export async function saveState(state: LocalState): Promise<void> {
  await writeJsonFile(getStatePath(), state);
}

export async function loadDaemonInfo(): Promise<DaemonInfo | null> {
  const parsed = await readJsonFile<DaemonInfo>(getDaemonInfoPath());
  if (!parsed || parsed.version !== 1 || !parsed.port || !parsed.token) {
    return null;
  }
  return parsed;
}

export async function saveDaemonInfo(info: DaemonInfo): Promise<void> {
  await writeJsonFile(getDaemonInfoPath(), info);
}

export async function loadWorkspaceManifest(
  path: string,
): Promise<WorkspaceManifest | null> {
  return readJsonFile<WorkspaceManifest>(path);
}

export async function saveWorkspaceManifest(
  path: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  await writeJsonFile(path, manifest);
}
