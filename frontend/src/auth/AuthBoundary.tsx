import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ApiClient,
  AuthBootstrapState,
  createAuthSessionBootstrap,
} from "../api/client";
import type { SubjectQueryLifecycle } from "../api/queryKeys";
import { AppShell } from "../components/AppShell";

type AuthSession = ReturnType<typeof createAuthSessionBootstrap>;

export interface AuthServices {
  authReady: boolean;
  subject: string | null;
  canLoadProtectedData: boolean;
  apiClient: ApiClient;
  signOut(): Promise<void>;
}

export interface AuthBoundaryProps {
  apiBaseUrl: string;
  apiClient: ApiClient;
  session: AuthSession;
  subjectLifecycle: SubjectQueryLifecycle;
  navigate?: (url: string) => void;
  children: ReactNode;
}

const AuthServicesContext = createContext<AuthServices | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthServices(): AuthServices {
  const services = useContext(AuthServicesContext);
  if (!services)
    throw new Error("useAuthServices must be used inside AuthBoundary.");
  return services;
}

export function AuthSignOutControl() {
  const { subject, signOut } = useAuthServices();
  if (!subject) return null;
  return (
    <button type="button" onClick={() => void signOut()}>
      Sign out {subject}
    </button>
  );
}

export function AuthBoundary({
  apiBaseUrl,
  apiClient,
  session,
  subjectLifecycle,
  navigate,
  children,
}: AuthBoundaryProps) {
  const [state, setState] = useState<AuthBootstrapState>({
    authReady: false,
    subject: null,
    statusMessage: "Checking your session…",
  });
  const authAttempt = useRef(0);

  const checkSession = useCallback(async () => {
    const attempt = ++authAttempt.current;
    const next = await session.load();
    if (attempt !== authAttempt.current) return;
    await subjectLifecycle.setSubject(next.subject);
    if (attempt !== authAttempt.current) return;
    setState(next);
  }, [session, subjectLifecycle]);

  useEffect(() => {
    void Promise.resolve().then(checkSession);
  }, [checkSession]);

  const signOut = useCallback(async () => {
    authAttempt.current += 1;
    const logout = session.logout().catch(() => undefined);
    await subjectLifecycle.setSubject(null);
    session.clear();
    setState({ authReady: true, subject: null, signInRequired: true });
    const result = await logout;
    if (result?.logoutUrl)
      (navigate ?? ((url) => window.location.assign(url)))(result.logoutUrl);
  }, [navigate, session, subjectLifecycle]);

  const services = useMemo<AuthServices>(
    () => ({
      authReady: state.authReady,
      subject: state.subject,
      canLoadProtectedData: state.authReady && state.subject !== null,
      apiClient,
      signOut,
    }),
    [apiClient, signOut, state.authReady, state.subject],
  );

  const authFallback = (
    <section aria-labelledby="welcome-heading">
      <h1 id="welcome-heading">Your horse ledger</h1>
      {state.authReady && state.signInRequired && (
        <a href={`${apiBaseUrl}/auth/login?returnTo=%2Fhorses`}>Sign in</a>
      )}
      {!state.authReady && state.statusKind === "assertive" && (
        <button
          type="button"
          onClick={() => {
            setState((current) => ({
              ...current,
              statusMessage: "Checking your session…",
            }));
            void checkSession();
          }}
        >
          Retry session check
        </button>
      )}
    </section>
  );

  return (
    <AuthServicesContext.Provider value={services}>
      <AppShell
        authReady={state.authReady}
        subject={state.subject}
        statusMessage={state.statusMessage}
        statusKind={state.statusKind}
        authFallback={authFallback}
      >
        {children}
      </AppShell>
    </AuthServicesContext.Provider>
  );
}
