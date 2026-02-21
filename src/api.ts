import type {
  DeployApplyResponse,
  DeployRunDetails,
  DeploymentConfiguration,
  DevicePollError,
  DevicePollSuccess,
  DeviceStartResponse,
  GetConfigurationResponse,
  ListConfigurationsResponse,
  UpdateConfigurationResponse,
} from "./types";

export class ApiError extends Error {
  status: number;
  code: string | null;
  details: unknown;
  retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number,
    code: string | null,
    details: unknown,
    retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type JsonObject = Record<string, unknown>;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: JsonObject | string;
  token?: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export class MinenetApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = token;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const headers = new Headers();

    const token = options.token ?? this.token;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    let body: string | undefined;
    if (typeof options.body === "string") {
      body = options.body;
      headers.set("Content-Type", "text/plain; charset=utf-8");
    } else if (options.body) {
      body = JSON.stringify(options.body);
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      cache: "no-store",
    });

    const retryAfterRaw = response.headers.get("Retry-After");
    const retryAfterSeconds = retryAfterRaw
      ? Number.parseInt(retryAfterRaw, 10)
      : null;

    const text = await response.text();
    let payload: unknown = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const message =
        typeof payload === "object" && payload && "error" in payload
          ? String((payload as Record<string, unknown>).error)
          : `Request failed (${response.status})`;
      const code =
        typeof payload === "object" && payload && "code" in payload
          ? String((payload as Record<string, unknown>).code)
          : null;

      throw new ApiError(message, response.status, code, payload, retryAfterSeconds);
    }

    return payload as T;
  }

  async startDeviceLogin(input: {
    deviceName?: string;
    os?: string;
    arch?: string;
    hostname?: string;
    cliVersion?: string;
  }): Promise<DeviceStartResponse> {
    return this.request<DeviceStartResponse>("/api/cli/v1/device/start", {
      method: "POST",
      body: {
        device_name: input.deviceName,
        os: input.os,
        arch: input.arch,
        hostname: input.hostname,
        cli_version: input.cliVersion,
      },
      token: "",
    });
  }

  async pollDeviceLogin(deviceCode: string): Promise<DevicePollSuccess | DevicePollError> {
    try {
      return await this.request<DevicePollSuccess>("/api/cli/v1/device/poll", {
        method: "POST",
        body: {
          device_code: deviceCode,
        },
        token: "",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && typeof error.details === "object") {
        const detail = error.details as Record<string, unknown>;
        return {
          error: String(detail.error ?? "invalid_request"),
          error_description: detail.error_description
            ? String(detail.error_description)
            : error.message,
          interval:
            typeof detail.interval === "number"
              ? detail.interval
              : undefined,
        };
      }
      throw error;
    }
  }

  async listDeploymentConfigurations(): Promise<ListConfigurationsResponse> {
    return this.request<ListConfigurationsResponse>("/api/client/v1/deployment/configurations", {
      method: "GET",
    });
  }

  async getDeploymentConfiguration(configurationId: string): Promise<GetConfigurationResponse> {
    return this.request<GetConfigurationResponse>(
      `/api/client/v1/deployment/configurations/${configurationId}`,
      { method: "GET" },
    );
  }

  async updateDeploymentConfiguration(input: {
    configurationId: string;
    name?: string;
    description?: string | null;
    yaml?: string;
  }): Promise<UpdateConfigurationResponse> {
    return this.request<UpdateConfigurationResponse>(
      `/api/client/v1/deployment/configurations/${input.configurationId}`,
      {
        method: "PUT",
        body: {
          name: input.name,
          description: input.description,
          yaml: input.yaml,
        },
      },
    );
  }

  async applyConfiguration(input: {
    configurationId: string;
    prune: boolean;
  }): Promise<DeployApplyResponse> {
    return this.request<DeployApplyResponse>("/api/client/v1/deployment", {
      method: "POST",
      body: {
        configuration_id: input.configurationId,
        prune: input.prune,
      },
    });
  }

  async getDeploymentRun(runId: string): Promise<DeployRunDetails> {
    return this.request<DeployRunDetails>(`/api/client/v1/deployment/runs/${runId}`, {
      method: "GET",
    });
  }
}

export function createApiClient(baseUrl: string, token: string): MinenetApiClient {
  return new MinenetApiClient(baseUrl, token);
}

export function toConfigurationMap(configurations: DeploymentConfiguration[]): Map<string, DeploymentConfiguration> {
  const map = new Map<string, DeploymentConfiguration>();
  for (const config of configurations) {
    map.set(config.id, config);
  }
  return map;
}
