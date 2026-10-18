import type { components, paths } from "./schema";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type GeneratedPath = Extract<keyof paths, string>;
type ExpandGeneratedPath<Path extends string> =
  Path extends `${infer Before}{${string}}${infer After}`
    ? `${Before}${string}${ExpandGeneratedPath<After>}`
    : Path;
type PlannedPath =
  | "/api/v1/expenses"
  | "/api/v1/income"
  | "/api/v1/driving"
  | "/api/v1/previews/financial"
  | "/api/v1/reports/monthly-pnl"
  | "/api/v1/reports/lifetime";
type ConcreteGeneratedPath = {
  [Path in GeneratedPath]: ExpandGeneratedPath<Path>;
}[GeneratedPath];
type QueryablePath = GeneratedPath | ConcreteGeneratedPath | PlannedPath;
type WithQuery<Path extends string> = Path | `${Path}?${string}`;
// Keep the accepted URL space finite. Generated route parameters are concrete strings,
// but operation lookup below normalizes those concrete URLs back to their OpenAPI key.
export type ApiPath = WithQuery<QueryablePath>;

type GeneratedMethod = Lowercase<HttpMethod>;
type StripQuery<Path extends string> = Path extends `${infer Route}?${string}`
  ? Route
  : Path;
type GeneratedRouteFor<Path extends string> = {
  [Route in GeneratedPath]: StripQuery<Path> extends ExpandGeneratedPath<Route>
    ? Route
    : never;
}[GeneratedPath];
type NormalizedPath<Path extends string> =
  StripQuery<Path> extends GeneratedPath | PlannedPath
    ? StripQuery<Path>
    : GeneratedRouteFor<Path>;
type Operation<P extends ApiPath, M extends GeneratedMethod> =
  NormalizedPath<P> extends keyof paths
    ? M extends keyof paths[NormalizedPath<P>]
      ? paths[NormalizedPath<P>][M]
      : never
    : never;
type OperationResponses<O> = O extends { responses: infer R } ? R : never;
type ApiJson<T> = [T] extends [null | undefined]
  ? T
  : [Exclude<T, null | undefined>] extends [number | string]
    ? [number | string] extends [Exclude<T, null | undefined>]
      ? null extends T
        ? number | null
        : number
      : T
    : T extends readonly (infer Item)[]
      ? ApiJson<Item>[]
      : T extends object
        ? { [Key in keyof T]: ApiJson<T[Key]> }
        : T;
type SuccessResponse<R> = {
  [S in keyof R]: S extends number
    ? `${S}` extends `2${string}`
      ? R[S]
      : never
    : S extends `2${string}`
      ? R[S]
      : never;
}[keyof R];
type JsonBody<R> = R extends { content: infer C }
  ? C extends { "application/json": infer Body }
    ? ApiJson<Body>
    : never
  : never;
export type ApiResponse<P extends ApiPath, M extends GeneratedMethod> = [
  Operation<P, M>,
] extends [never]
  ? unknown
  : JsonBody<SuccessResponse<OperationResponses<Operation<P, M>>>>;

export type ApiHorseStatus = "Active" | "Leased" | "Retired" | "Sold";
export type ApiSplit = ApiJson<components["schemas"]["SplitRequest"]>;
export type ApiExpenseBody = ApiJson<
  components["schemas"]["CreateExpenseRequest"]
>;
export type ApiIncomeBody = ApiJson<
  components["schemas"]["CreateIncomeRequest"]
>;
export type ApiFinancialPreviewRequest = ApiJson<
  components["schemas"]["FinancialPreviewRequest"]
>;
export type ApiRequestBody<
  P extends ApiPath,
  M extends GeneratedMethod,
> = P extends ApiPath
  ? NormalizedPath<P> extends keyof CanonicalRequestBodyMap
    ? CanonicalRequestBodyMap[NormalizedPath<P>]
    : [Operation<P, M>] extends [never]
      ? unknown
      : Operation<P, M> extends { requestBody: infer Body }
        ? [Body] extends [never]
          ? unknown
          : JsonBody<Body>
        : unknown
  : never;
type CanonicalRequestBodyMap = {
  "/api/v1/account": { currency: string; timeZone: string };
  "/api/v1/driving-rate": { rateMinorPerKm: number };
  "/api/v1/driving": {
    expenseDate: string;
    kilometers: number;
    rateMinorPerKm: number;
    description: string;
    split: ApiSplit;
  };
  "/api/v1/horses": {
    name: string;
    breed: string;
    dateOfBirth: string | null;
    status: ApiHorseStatus;
  };
  "/api/v1/horses/{horseId}": Partial<{
    name: string;
    breed: string;
    dateOfBirth: string | null;
  }>;
  "/api/v1/horses/{horseId}/status": { status: ApiHorseStatus };
};

export type ApiErrorDetail = components["schemas"]["ApiErrorDetail"];
export type ApiErrorDto = ApiJson<components["schemas"]["ApiError"]>;

export class ApiError extends Error implements ApiErrorDto {
  readonly code: string;
  readonly correlationId: string;
  readonly details?: ApiErrorDetail[] | null;
  readonly streamVersion?: number | null;

  constructor(status: number, dto: ApiErrorDto) {
    super(dto.message);
    this.name = "ApiError";
    this.status = status;
    this.code = dto.code;
    this.correlationId = dto.correlationId;
    this.details = dto.details;
    this.streamVersion = dto.streamVersion;
  }

  readonly status: number;
}

export class SubjectChangedError extends Error {
  constructor() {
    super(
      "The authenticated subject changed while the request was in progress.",
    );
    this.name = "SubjectChangedError";
  }
}

export interface ApiClientOptions {
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface AuthBootstrapState {
  authReady: boolean;
  subject: string | null;
  statusMessage?: string;
  statusKind?: "polite" | "assertive";
  signInRequired?: boolean;
}

export interface AuthSessionBootstrapOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export function createAuthSessionBootstrap({
  fetchImpl = fetch,
  baseUrl = "",
}: AuthSessionBootstrapOptions) {
  let accessToken: string | null = null;
  let csrfToken: string | null = null;
  let subject: string | null = null;
  let generation = 0;

  function clear(): void {
    generation += 1;
    accessToken = null;
    csrfToken = null;
    subject = null;
  }

  function signedOut(): AuthBootstrapState {
    accessToken = null;
    csrfToken = null;
    subject = null;
    return {
      authReady: true,
      subject: null,
      signInRequired: true,
      statusMessage: "Sign in to open your private horse ledger.",
    };
  }

  async function load(): Promise<AuthBootstrapState> {
    const requestGeneration = ++generation;
    try {
      const response = await fetchImpl(`${baseUrl}/auth/session`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (requestGeneration !== generation)
        return { authReady: false, subject };
      if (response.status === 401) return signedOut();
      if (!response.ok) throw new Error("session unavailable");
      const session = parseSession(await response.json());
      if (requestGeneration !== generation)
        return { authReady: false, subject };

      let token = session.accessToken;
      let refreshedSubject = session.user.id;
      csrfToken = session.csrfToken;
      if (!token) {
        const refresh = await fetchImpl(`${baseUrl}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "X-CSRF-Token": csrfToken },
        });
        if (requestGeneration !== generation)
          return { authReady: false, subject };
        if (refresh.status === 401) return signedOut();
        if (!refresh.ok) throw new Error("session refresh unavailable");
        const refreshed = parseSession(await refresh.json(), session.csrfToken);
        if (refreshed.user.id !== session.user.id)
          throw new Error("session identity changed");
        refreshedSubject = refreshed.user.id;
        token = refreshed.accessToken;
      }
      if (!token) throw new Error("session has no access token");
      if (requestGeneration !== generation)
        return { authReady: false, subject };
      accessToken = token;
      subject = refreshedSubject;
      return { authReady: true, subject };
    } catch {
      if (requestGeneration !== generation)
        return { authReady: false, subject };
      return {
        authReady: false,
        subject,
        statusKind: "assertive",
        statusMessage:
          "Could not check your sign-in. Check your connection and retry.",
      };
    }
  }

  return {
    load,
    async logout(): Promise<{ logoutUrl: string }> {
      if (!csrfToken) throw new Error("The session is not ready to sign out.");
      const response = await fetchImpl(`${baseUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Sign out could not be completed.");
      const body = (await response.json()) as { logoutUrl?: unknown };
      if (typeof body.logoutUrl !== "string")
        throw new Error("The sign-out response was invalid.");
      const destination = new URL(body.logoutUrl);
      if (
        destination.protocol !== "https:" ||
        destination.hostname !== "api.workos.com"
      ) {
        throw new Error("The sign-out destination was invalid.");
      }
      return { logoutUrl: destination.toString() };
    },
    getAccessToken: async (): Promise<string | null> => accessToken,
    getCsrfToken: (): string | null => csrfToken,
    clear,
  };
}

interface SessionBody {
  user: { id: string };
  accessToken?: string;
  csrfToken: string;
}

function parseSession(value: unknown, csrfTokenFallback?: string): SessionBody {
  if (typeof value !== "object" || value === null)
    throw new Error("invalid session response");
  const body = value as Partial<SessionBody>;
  const csrfToken =
    typeof body.csrfToken === "string" ? body.csrfToken : csrfTokenFallback;
  if (
    typeof body.user?.id !== "string" ||
    !body.user.id ||
    typeof csrfToken !== "string"
  ) {
    throw new Error("invalid session response");
  }
  if (body.accessToken !== undefined && typeof body.accessToken !== "string") {
    throw new Error("invalid session response");
  }
  return { ...body, csrfToken } as SessionBody;
}

export interface ApiRequest<P extends ApiPath = ApiPath> {
  subject: string;
  path: P;
  signal?: AbortSignal;
}

export interface ApiCommand<
  P extends ApiPath = ApiPath,
  M extends Exclude<HttpMethod, "GET"> = Exclude<HttpMethod, "GET">,
> {
  readonly subject: string;
  readonly method: M;
  readonly path: P;
  readonly body: string;
  readonly idempotencyKey: string;
  readonly streamVersion: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ApiClient {
  setSubject(subject: string | null): Promise<void>;
  get<P extends ApiPath>(
    request: ApiRequest<P>,
  ): Promise<ApiResponse<P, "get">>;
  preview<P extends ApiPath>(request: {
    subject: string;
    path: P;
    body: ApiRequestBody<P, "post">;
  }): Promise<ApiResponse<P, "post">>;
  createCommand<
    P extends ApiPath,
    M extends Exclude<HttpMethod, "GET">,
  >(command: {
    subject: string;
    method: M;
    path: P;
    body: ApiRequestBody<P, Lowercase<M>>;
    streamVersion: number;
    idempotencyKey?: string;
  }): ApiCommand<P, M>;
  sendCommand<P extends ApiPath, M extends Exclude<HttpMethod, "GET">>(
    command: ApiCommand<P, M>,
  ): Promise<ApiResponse<P, Lowercase<M>>>;
  rememberVersion(subject: string, streamVersion: number): number;
  lastSeenVersion(subject: string): number | undefined;
  cursorForVersion(
    cursor: string,
    streamVersion: number,
    subject: string,
  ): string | undefined;
}

export function createApiClient({
  getAccessToken,
  fetchImpl = fetch,
  baseUrl = "",
}: ApiClientOptions): ApiClient {
  let activeSubject: string | null = null;
  let epoch = 0;
  const inFlight = new Set<AbortController>();
  const versions = new Map<string, number>();

  async function setSubject(subject: string | null): Promise<void> {
    if (subject === activeSubject) return;
    activeSubject = subject;
    epoch += 1;
    versions.clear();
    for (const controller of inFlight) controller.abort();
    inFlight.clear();
  }

  async function request<T>(
    subject: string,
    path: ApiPath,
    method: HttpMethod,
    body?: string,
    commandHeaders?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!subject || subject !== activeSubject) throw new SubjectChangedError();
    const requestEpoch = epoch;
    const token = await getAccessToken();
    if (requestEpoch !== epoch || subject !== activeSubject)
      throw new SubjectChangedError();
    if (!token)
      throw new ApiError(401, {
        code: "unauthenticated",
        message: "Sign in to continue.",
        correlationId: "unavailable",
      });

    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    inFlight.add(controller);
    const headers = new Headers(commandHeaders);
    headers.set("Authorization", `Bearer ${token}`);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (requestEpoch !== epoch || subject !== activeSubject)
        throw new SubjectChangedError();
      if (!response.ok) {
        const error = await readApiError(response);
        if (requestEpoch !== epoch || subject !== activeSubject)
          throw new SubjectChangedError();
        throw new ApiError(response.status, error);
      }
      if (response.status === 204) return undefined as T;
      const data = (await response.json()) as T;
      if (requestEpoch !== epoch || subject !== activeSubject)
        throw new SubjectChangedError();
      assertSafeApiNumbers(data);
      return data;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      inFlight.delete(controller);
    }
  }

  function createCommand<
    P extends ApiPath,
    M extends Exclude<HttpMethod, "GET">,
  >(command: {
    subject: string;
    method: M;
    path: P;
    body: ApiRequestBody<P, Lowercase<M>>;
    streamVersion: number;
    idempotencyKey?: string;
  }): ApiCommand<P, M> {
    if (command.subject !== activeSubject) throw new SubjectChangedError();
    const idempotencyKey = command.idempotencyKey ?? crypto.randomUUID();
    const descriptor = {
      subject: command.subject,
      method: command.method,
      path: command.path,
      body: JSON.stringify(command.body),
      idempotencyKey,
      streamVersion: command.streamVersion,
      headers: Object.freeze({
        "Idempotency-Key": idempotencyKey,
        "If-Match": `"${command.streamVersion}"`,
      }),
    } satisfies ApiCommand<P, M>;
    return Object.freeze(descriptor);
  }

  return {
    setSubject,
    get: <P extends ApiPath>(input: ApiRequest<P>) =>
      request<ApiResponse<P, "get">>(
        input.subject,
        input.path,
        "GET",
        undefined,
        undefined,
        input.signal,
      ),
    preview: <P extends ApiPath>(input: {
      subject: string;
      path: P;
      body: ApiRequestBody<P, "post">;
    }) =>
      request<ApiResponse<P, "post">>(
        input.subject,
        input.path,
        "POST",
        JSON.stringify(input.body),
      ),
    createCommand,
    sendCommand: (command) =>
      request<
        ApiResponse<typeof command.path, Lowercase<typeof command.method>>
      >(
        command.subject,
        command.path,
        command.method,
        command.body,
        command.headers,
      ),
    rememberVersion(subject, streamVersion) {
      const remembered = Math.max(versions.get(subject) ?? 0, streamVersion);
      versions.set(subject, remembered);
      return remembered;
    },
    lastSeenVersion(subject) {
      return versions.get(subject);
    },
    cursorForVersion(cursor, streamVersion, subject) {
      const current = versions.get(subject);
      return current !== undefined && current !== streamVersion
        ? undefined
        : cursor;
    },
  };
}

async function readApiError(response: Response): Promise<ApiErrorDto> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (isApiErrorDto(body)) {
    assertSafeApiNumbers(body);
    return body;
  }
  return {
    code: "request_failed",
    message: "The request could not be completed. Try again.",
    correlationId: "unavailable",
  };
}

const safeIntegerFields = new Set([
  "amountMinor",
  "contributionMinor",
  "count",
  "expenseDeltaMinor",
  "expenseMinor",
  "incomeDeltaMinor",
  "incomeMinor",
  "minutes",
  "netDeltaMinor",
  "netMinor",
  "streamVersion",
  "weight",
]);

function assertSafeApiNumbers(value: unknown, field?: string): void {
  if (field && safeIntegerFields.has(field)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value))
      throw new Error("API response contains an unsafe integer");
    return;
  }
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    )
      throw new Error("API response contains an unsafe integer");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeApiNumbers(item);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value))
      assertSafeApiNumbers(item, key);
  }
}

function isApiErrorDto(value: unknown): value is ApiErrorDto {
  if (typeof value !== "object" || value === null) return false;
  const dto = value as Partial<ApiErrorDto>;
  return (
    typeof dto.code === "string" &&
    typeof dto.message === "string" &&
    typeof dto.correlationId === "string"
  );
}
