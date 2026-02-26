import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { ApiError, createApiClient } from "./api";
import { sha256Hex, slugify } from "./hash";
import {
  loadWorkspaceManifest,
  saveWorkspaceManifest,
} from "./paths";
import type {
  DeploymentConfiguration,
  StoredProfile,
  WorkspaceConflict,
  WorkspaceManifest,
  WorkspaceManifestEntry,
  WorkspacePushFailure,
} from "./types";

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function computeLocalHash(contents: string): string {
  return sha256Hex(contents);
}

function getManifestPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".minenet", "workspace.json");
}

function getConfigFilePath(workspaceRoot: string, directoryName: string): string {
  return join(workspaceRoot, directoryName, "config.yml");
}

async function ensureWorkspaceFolders(workspaceRoot: string): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(join(workspaceRoot, ".minenet"), { recursive: true });
}

async function readFileIfPresent(path: string): Promise<string | null> {
  if (!existsSync(path)) {
    return null;
  }
  return readFile(path, "utf8");
}

function ensureUniqueDirectoryName(
  desired: string,
  used: Set<string>,
): string {
  let candidate = desired;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${desired}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function pickDirectoryName(
  workspaceRoot: string,
  configuration: DeploymentConfiguration,
  existingEntry: WorkspaceManifestEntry | undefined,
  used: Set<string>,
): string {
  if (existingEntry?.directoryName) {
    used.add(existingEntry.directoryName);
    return existingEntry.directoryName;
  }

  const desired = slugify(configuration.name);
  const selected = ensureUniqueDirectoryName(desired, used);

  if (existsSync(join(workspaceRoot, selected))) {
    return ensureUniqueDirectoryName(`${selected}-config`, used);
  }

  return selected;
}

function hasConflict(
  entry: WorkspaceManifestEntry,
  localHash: string | null,
  remoteHash: string,
): boolean {
  if (!localHash) {
    return false;
  }

  const localChanged = localHash !== entry.lastLocalHash;
  const remoteChanged = remoteHash !== entry.lastPulledRemoteHash;

  return localChanged && remoteChanged;
}

function getConfigurationHash(configuration: DeploymentConfiguration): string {
  if (configuration.spec_hash) {
    return configuration.spec_hash;
  }

  if (configuration.config_hash) {
    return configuration.config_hash;
  }

  throw new Error(
    `Configuration ${configuration.id} is missing hash fields (spec_hash/config_hash)`,
  );
}

function normalizeWorkspaceRoot(
  cwd: string,
  workspacePath: string | undefined,
  teamSlug: string,
): string {
  if (!workspacePath || !workspacePath.trim()) {
    return resolve(cwd, teamSlug);
  }

  if (isAbsolute(workspacePath)) {
    return workspacePath;
  }

  return resolve(cwd, workspacePath);
}

function createManifest(
  profile: StoredProfile,
  current: WorkspaceManifest | null,
): WorkspaceManifest {
  return {
    version: 1,
    teamId: profile.teamId,
    teamSlug: profile.teamSlug,
    apiBaseUrl: profile.apiBaseUrl,
    entries: current?.entries ?? {},
    updatedAt: Date.now(),
  };
}

export async function pullWorkspace(input: {
  profile: StoredProfile;
  cwd: string;
  workspacePath?: string;
  force: boolean;
}) {
  const workspaceRoot = normalizeWorkspaceRoot(
    input.cwd,
    input.workspacePath,
    input.profile.teamSlug,
  );

  await ensureWorkspaceFolders(workspaceRoot);

  const manifestPath = getManifestPath(workspaceRoot);
  const currentManifest = await loadWorkspaceManifest(manifestPath);
  const manifest = createManifest(input.profile, currentManifest);

  const client = createApiClient(input.profile.apiBaseUrl, input.profile.token);
  const remote = await client.listDeploymentConfigurations();
  const usedDirectories = new Set<string>();
  const conflicts: WorkspaceConflict[] = [];

  const writes: Array<{
    configuration: DeploymentConfiguration;
    directoryName: string;
    normalizedYaml: string;
    localHash: string;
  }> = [];

  for (const configuration of remote.configurations) {
    const existing = manifest.entries[configuration.id];
    const directoryName = pickDirectoryName(
      workspaceRoot,
      configuration,
      existing,
      usedDirectories,
    );
    const configPath = getConfigFilePath(workspaceRoot, directoryName);

    const localContent = await readFileIfPresent(configPath);
    const localHash = localContent ? computeLocalHash(localContent) : null;

    const remoteHash = getConfigurationHash(configuration);
    if (existing && hasConflict(existing, localHash, remoteHash) && !input.force) {
      conflicts.push({
        configurationId: configuration.id,
        configurationName: configuration.name,
        directoryName,
        reason: "local_and_remote_changed",
      });
      continue;
    }

    const normalizedYaml = ensureTrailingNewline(configuration.yaml);
    writes.push({
      configuration,
      directoryName,
      normalizedYaml,
      localHash: computeLocalHash(normalizedYaml),
    });
  }

  if (conflicts.length > 0) {
    return {
      ok: false as const,
      workspaceRoot,
      conflicts,
      pulled: 0,
      skipped: remote.count,
    };
  }

  for (const item of writes) {
    const directoryPath = join(workspaceRoot, item.directoryName);
    const configPath = getConfigFilePath(workspaceRoot, item.directoryName);

    await mkdir(directoryPath, { recursive: true });
    await writeFile(configPath, item.normalizedYaml, "utf8");

    manifest.entries[item.configuration.id] = {
      configurationId: item.configuration.id,
      configurationName: item.configuration.name,
      directoryName: item.directoryName,
      lastPulledRemoteHash: getConfigurationHash(item.configuration),
      lastLocalHash: item.localHash,
      updatedAt: Date.now(),
    };
  }

  manifest.updatedAt = Date.now();
  await saveWorkspaceManifest(manifestPath, manifest);

  return {
    ok: true as const,
    workspaceRoot,
    pulled: writes.length,
    count: remote.count,
    conflicts: [] as WorkspaceConflict[],
  };
}

function resolveTargets(
  manifest: WorkspaceManifest,
  selector: string | undefined,
): WorkspaceManifestEntry[] {
  const entries = Object.values(manifest.entries);
  if (!selector || !selector.trim()) {
    return entries;
  }

  const clean = selector.trim();
  return entries.filter(
    (entry) =>
      entry.configurationId === clean ||
      entry.directoryName === clean ||
      basename(entry.directoryName) === clean,
  );
}

async function listTopLevelConfigDirectories(workspaceRoot: string): Promise<string[]> {
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const directories: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === ".minenet") {
      continue;
    }

    if (existsSync(getConfigFilePath(workspaceRoot, entry.name))) {
      directories.push(entry.name);
    }
  }

  return directories.sort((left, right) => left.localeCompare(right));
}

function resolveLocalDirectoryTargets(
  localDirectoryNames: string[],
  selector: string | undefined,
): string[] {
  if (!selector || !selector.trim()) {
    return localDirectoryNames;
  }

  const clean = selector.trim();
  return localDirectoryNames.filter(
    (directoryName) =>
      directoryName === clean || basename(directoryName) === clean,
  );
}

function toPushFailure(
  error: unknown,
  base: Omit<WorkspacePushFailure, "reason" | "code">,
): WorkspacePushFailure {
  if (error instanceof ApiError) {
    let validationIssues: WorkspacePushFailure["validationIssues"];
    if (
      error.details &&
      typeof error.details === "object" &&
      "issues" in error.details &&
      Array.isArray((error.details as { issues?: unknown }).issues)
    ) {
      const parsedIssues = (error.details as { issues: unknown[] }).issues
        .map((issue) => {
          if (!issue || typeof issue !== "object") {
            return null;
          }

          const record = issue as Record<string, unknown>;
          if (typeof record.message !== "string") {
            return null;
          }

          return {
            path: typeof record.path === "string" ? record.path : undefined,
            message: record.message,
          };
        })
        .filter((issue): issue is { path?: string; message: string } => Boolean(issue));

      if (parsedIssues.length > 0) {
        validationIssues = parsedIssues;
      }
    }

    return {
      ...base,
      reason: error.message,
      code: error.code ?? undefined,
      validationIssues,
    };
  }

  if (error instanceof Error) {
    return {
      ...base,
      reason: error.message,
    };
  }

  return {
    ...base,
    reason: "Unexpected error",
  };
}

export async function pushWorkspace(input: {
  profile: StoredProfile;
  cwd: string;
  workspacePath?: string;
  selector?: string;
  force: boolean;
}) {
  const workspaceRoot = normalizeWorkspaceRoot(
    input.cwd,
    input.workspacePath,
    input.profile.teamSlug,
  );
  const manifestPath = getManifestPath(workspaceRoot);
  const manifest = await loadWorkspaceManifest(manifestPath);

  if (!manifest) {
    throw new Error("Workspace manifest not found. Run `minenet pull` first.");
  }

  const client = createApiClient(input.profile.apiBaseUrl, input.profile.token);
  const manifestTargets = resolveTargets(manifest, input.selector);
  const localConfigDirectories = await listTopLevelConfigDirectories(workspaceRoot);
  const localConfigDirectorySet = new Set(localConfigDirectories);
  const localDirectoryTargets = resolveLocalDirectoryTargets(
    localConfigDirectories,
    input.selector,
  );

  if (
    input.selector &&
    input.selector.trim() &&
    manifestTargets.length === 0 &&
    localDirectoryTargets.length === 0
  ) {
    throw new Error("No matching configurations found in workspace.");
  }

  const manifestDirectoryMap = new Map<string, WorkspaceManifestEntry>();
  for (const entry of Object.values(manifest.entries)) {
    manifestDirectoryMap.set(entry.directoryName, entry);
  }

  const updateTargets = manifestTargets.filter((entry) =>
    localConfigDirectorySet.has(entry.directoryName),
  );
  const deleteTargets = manifestTargets.filter(
    (entry) => !localConfigDirectorySet.has(entry.directoryName),
  );
  const createDirectories = localDirectoryTargets.filter(
    (directoryName) => !manifestDirectoryMap.has(directoryName),
  );

  const conflicts: WorkspaceConflict[] = [];
  const updated: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  const skipped: string[] = [];
  const failed: WorkspacePushFailure[] = [];

  for (const entry of updateTargets) {
    const configPath = getConfigFilePath(workspaceRoot, entry.directoryName);
    const localContent = await readFileIfPresent(configPath);
    if (!localContent) {
      skipped.push(entry.configurationId);
      continue;
    }

    const localHash = computeLocalHash(localContent);
    let remoteHash: string;
    try {
      const remote = await client.getDeploymentConfiguration(entry.configurationId);
      remoteHash = getConfigurationHash(remote.configuration);
    } catch (error) {
      failed.push(
        toPushFailure(error, {
          configurationId: entry.configurationId,
          directoryName: entry.directoryName,
          operation: "update",
        }),
      );
      continue;
    }

    if (hasConflict(entry, localHash, remoteHash) && !input.force) {
      conflicts.push({
        configurationId: entry.configurationId,
        configurationName: entry.configurationName,
        directoryName: entry.directoryName,
        reason: "local_and_remote_changed",
      });
      continue;
    }

    if (
      entry.lastLocalHash === localHash &&
      entry.lastPulledRemoteHash === remoteHash
    ) {
      skipped.push(entry.configurationId);
      continue;
    }

    try {
      const result = await client.updateDeploymentConfiguration({
        configurationId: entry.configurationId,
        name: entry.configurationName,
        yaml: localContent,
      });

      entry.lastPulledRemoteHash = getConfigurationHash(result.configuration);
      entry.lastLocalHash = localHash;
      entry.configurationName = result.configuration.name;
      entry.updatedAt = Date.now();
      updated.push(entry.configurationId);
    } catch (error) {
      failed.push(
        toPushFailure(error, {
          configurationId: entry.configurationId,
          directoryName: entry.directoryName,
          operation: "update",
        }),
      );
    }
  }

  for (const directoryName of createDirectories) {
    const configPath = getConfigFilePath(workspaceRoot, directoryName);
    const localContent = await readFileIfPresent(configPath);
    if (!localContent) {
      failed.push({
        directoryName,
        operation: "create",
        reason: "Local config.yml not found",
      });
      continue;
    }

    try {
      const result = await client.createDeploymentConfiguration({
        name: directoryName,
        yaml: localContent,
      });
      const configuration = result.configuration;
      manifest.entries[configuration.id] = {
        configurationId: configuration.id,
        configurationName: configuration.name,
        directoryName,
        lastPulledRemoteHash: getConfigurationHash(configuration),
        lastLocalHash: computeLocalHash(localContent),
        updatedAt: Date.now(),
      };
      created.push(configuration.id);
    } catch (error) {
      failed.push(
        toPushFailure(error, {
          directoryName,
          operation: "create",
        }),
      );
    }
  }

  for (const entry of deleteTargets) {
    try {
      const result = await client.deleteDeploymentConfiguration(entry.configurationId);
      if (!result.ok) {
        failed.push({
          configurationId: entry.configurationId,
          directoryName: entry.directoryName,
          operation: "delete",
          reason: result.message ?? "Failed to delete configuration",
          code: result.code,
        });
        continue;
      }

      delete manifest.entries[entry.configurationId];
      deleted.push(entry.configurationId);
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.code === "CONFIGURATION_NOT_FOUND")
      ) {
        delete manifest.entries[entry.configurationId];
        deleted.push(entry.configurationId);
        continue;
      }

      failed.push(
        toPushFailure(error, {
          configurationId: entry.configurationId,
          directoryName: entry.directoryName,
          operation: "delete",
        }),
      );
    }
  }

  manifest.updatedAt = Date.now();
  await saveWorkspaceManifest(manifestPath, manifest);

  const ok = conflicts.length === 0 && failed.length === 0;
  return {
    ok,
    workspaceRoot,
    conflicts,
    updated,
    created,
    deleted,
    skipped,
    failed,
  };
}

export async function deployWorkspace(input: {
  profile: StoredProfile;
  cwd: string;
  workspacePath?: string;
  selector?: string;
}) {
  const workspaceRoot = normalizeWorkspaceRoot(
    input.cwd,
    input.workspacePath,
    input.profile.teamSlug,
  );
  const manifestPath = getManifestPath(workspaceRoot);
  const manifest = await loadWorkspaceManifest(manifestPath);

  if (!manifest) {
    throw new Error("Workspace manifest not found. Run `minenet pull` first.");
  }

  const targets = resolveTargets(manifest, input.selector);
  if (targets.length === 0) {
    throw new Error("No matching configurations found in workspace.");
  }

  const client = createApiClient(input.profile.apiBaseUrl, input.profile.token);
  const queued: Array<{ configurationId: string; runId: string; status: string }> = [];

  for (const target of targets) {
    const result = await client.applyConfiguration({
      configurationId: target.configurationId,
    });

    queued.push({
      configurationId: target.configurationId,
      runId: result.run.id,
      status: result.run.status,
    });
  }

  return {
    workspaceRoot,
    queued,
  };
}

export async function getRunStatus(input: {
  profile: StoredProfile;
  runId: string;
}) {
  const client = createApiClient(input.profile.apiBaseUrl, input.profile.token);
  return client.getDeploymentRun(input.runId);
}

export async function workspaceStatus(input: {
  profile: StoredProfile;
  cwd: string;
  workspacePath?: string;
}) {
  const workspaceRoot = normalizeWorkspaceRoot(
    input.cwd,
    input.workspacePath,
    input.profile.teamSlug,
  );
  const manifestPath = getManifestPath(workspaceRoot);
  const manifest = await loadWorkspaceManifest(manifestPath);

  return {
    workspaceRoot,
    hasManifest: Boolean(manifest),
    manifest,
  };
}
