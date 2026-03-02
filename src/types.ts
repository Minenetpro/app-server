export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type StoredProfile = {
  teamId: string;
  teamSlug: string;
  teamName: string;
  token: string;
  tokenName: string;
  createdAt: number;
  apiBaseUrl: string;
};

export type LocalState = {
  version: 1;
  currentTeamId: string | null;
  profiles: Record<string, StoredProfile>;
};

export type DaemonInfo = {
  version: 1;
  port: number;
  token: string;
  pid: number;
  startedAt: number;
};

export type WorkspaceManifestEntry = {
  configurationId: string;
  configurationName: string;
  directoryName: string;
  lastPulledRemoteHash: string;
  lastLocalHash: string;
  updatedAt: number;
};

export type WorkspaceManifest = {
  version: 1;
  teamId: string;
  teamSlug: string;
  apiBaseUrl: string;
  entries: Record<string, WorkspaceManifestEntry>;
  updatedAt: number;
};

export type DeploymentConfiguration = {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  yaml: string;
  spec_hash: string;
  config_hash?: string;
  resource_count: number;
  created_at: number;
  updated_at: number;
  latest_pushed_version_id?: string | null;
  latest_pushed_version_number?: number | null;
  latest_pushed_spec_hash?: string | null;
  latest_pushed_at?: number | null;
};

export type DeploymentConfigurationVersion = {
  id: string;
  configuration_id: string;
  version_number: number;
  spec_hash: string;
  resource_count: number;
  pushed_by: string;
  pushed_at: number;
  push_message?: string | null;
  base_version_id: string | null;
  yaml?: string;
  spec?: unknown;
};

export type ListConfigurationsResponse = {
  configurations: DeploymentConfiguration[];
  count: number;
};

export type GetConfigurationResponse = {
  configuration: DeploymentConfiguration;
};

export type UpdateConfigurationResponse = {
  ok: boolean;
  configuration: DeploymentConfiguration;
};

export type CreateConfigurationResponse = {
  ok: boolean;
  configuration: DeploymentConfiguration;
};

export type DeleteConfigurationResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  details?: {
    compute?: number;
    swiftbase?: number;
    total?: number;
  };
};

export type PushConfigurationVersionResponse = {
  ok: boolean;
  created: boolean;
  version: DeploymentConfigurationVersion;
};

export type ListConfigurationVersionsResponse = {
  versions: DeploymentConfigurationVersion[];
  count: number;
  next_cursor?: string | null;
};

export type GetConfigurationVersionResponse = {
  version: DeploymentConfigurationVersion;
};

export type DiffConfigurationVersionsResponse = {
  ok: boolean;
  from: DeploymentConfigurationVersion | null;
  to: DeploymentConfigurationVersion;
  diff: {
    unified: string;
    truncated: boolean;
    stats: {
      added: number;
      removed: number;
    };
  };
  has_changes: boolean;
};

export type DeployApplyResponse = {
  ok: boolean;
  push?: {
    created: boolean;
    version_id: string;
    version_number: number;
  };
  run: {
    id: string;
    status: DeploymentRunStatus;
    configuration_id: string;
    configuration_version_id?: string | null;
    configuration_version_number?: number | null;
    resource_count: number;
    queue_position: number | null;
    created_at: number;
    server_count?: number;
    proxy_count?: number;
    swiftbase_count?: number;
  };
};

export type DeploymentRunStatus =
  | "queued"
  | "planning"
  | "executing"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "running"
  | "completed";

export type DeploymentRunStage = "planning" | "executing" | "finalizing" | null;

export type DeploymentRunSummary = {
  create: number;
  update: number;
  replace: number;
  delete: number;
  noop: number;
  succeeded?: number;
  success?: number;
  failed: number;
};

export type DeployRunDetails = {
  run: {
    id: string;
    status: DeploymentRunStatus;
    stage: DeploymentRunStage;
    configuration_id: string;
    configuration_version_id?: string | null;
    configuration_version_number?: number | null;
    spec_hash: string;
    resource_count: number;
    queue_position: number | null;
    summary: DeploymentRunSummary | null;
    checkpoint: unknown;
    created_at: number;
    started_at: number | null;
    completed_at: number | null;
    error: string | null;
    failure_class: string | null;
  };
  resources: Array<{
    resource_key: string;
    resource_type: string;
    action: string;
    status: "pending" | "running" | "succeeded" | "failed";
    attempt: number;
    desired: unknown;
    before: unknown;
    after: unknown;
    log: unknown;
    error: string | null;
    started_at: number | null;
    completed_at: number | null;
    updated_at: number;
  }>;
  events: Array<{
    event_type: string;
    stage: DeploymentRunStage;
    message: string | null;
    data: unknown;
    created_at: number;
  }>;
};

export type DeviceStartResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type DevicePollSuccess = {
  access_token: string;
  token_type: "Bearer";
  team_id: string;
  team_slug: string | null;
  team_name: string | null;
  token_name: string | null;
  created_at: number | null;
};

export type DevicePollError = {
  error: string;
  error_description?: string;
  interval?: number;
};

export type WorkspaceConflict = {
  configurationId: string;
  configurationName: string;
  directoryName: string;
  reason: string;
};

export type WorkspacePushFailure = {
  configurationId?: string;
  directoryName: string;
  operation: "create" | "update" | "delete" | "push";
  reason: string;
  code?: string;
  validationIssues?: Array<{
    path?: string;
    message: string;
  }>;
};
