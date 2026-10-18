import { createContext, useContext, type ReactNode } from "react";

const navigation = [
  ["Horses", "/horses"],
  ["Expenses", "/expenses"],
  ["Income", "/income"],
  ["Approvals", "/approvals"],
  ["Tasks", "/tasks"],
  ["Reports", "/reports"],
  ["Settings", "/settings"],
] as const;

export interface AppShellProps {
  authReady: boolean;
  subject: string | null;
  statusMessage?: string;
  statusKind?: "polite" | "assertive";
  authFallback?: ReactNode;
  children: ReactNode;
}

export interface AuthBoundaryState {
  authReady: boolean;
  subject: string | null;
  canLoadProtectedData: boolean;
}

const AuthBoundaryContext = createContext<AuthBoundaryState>({
  authReady: false,
  subject: null,
  canLoadProtectedData: false,
});

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthBoundary(): AuthBoundaryState {
  return useContext(AuthBoundaryContext);
}

export function AppShell({
  authReady,
  subject,
  statusMessage,
  statusKind = "polite",
  authFallback,
  children,
}: AppShellProps) {
  const authenticated = authReady && subject !== null;
  return (
    <div className="app-shell">
      <header>
        <a href="/horses" aria-label="Horse ledger home">
          Horse ledger
        </a>
        {authenticated && (
          <nav aria-label="Primary navigation">
            {navigation.map(([label, href]) => (
              <a href={href} key={href}>
                {label}
              </a>
            ))}
          </nav>
        )}
      </header>
      {!authReady && <p role="status">Loading your account…</p>}
      {authReady && !subject && (
        <p role="status">Sign in to open your private horse ledger.</p>
      )}
      {statusMessage && (
        <p
          role={statusKind === "assertive" ? "alert" : "status"}
          aria-live={statusKind}
        >
          {statusMessage}
        </p>
      )}
      <main aria-busy={!authReady}>
        {subject !== null ? (
          <AuthBoundaryContext.Provider
            value={{
              authReady,
              subject,
              canLoadProtectedData: authReady,
            }}
          >
            <div
              key={subject}
              className="app-content"
              hidden={!authReady}
              aria-hidden={!authReady}
              inert={!authReady}
            >
              {children}
            </div>
          </AuthBoundaryContext.Provider>
        ) : (
          authFallback
        )}
      </main>
    </div>
  );
}
