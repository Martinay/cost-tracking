import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon";

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
  accountControls?: ReactNode;
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
  accountControls,
}: AppShellProps) {
  const authenticated = authReady && subject !== null;
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (authenticated && window.innerWidth <= 700) {
      const current = nav.current?.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      if (current && nav.current) {
        nav.current.scrollLeft =
          current.offsetLeft - nav.current.offsetLeft - 20;
      }
    }
  }, [authenticated]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="sidebar">
        <a className="brand" href="/horses" aria-label="Horse ledger home">
          <span className="brand-mark">
            <Icon name="horses" />
          </span>
          <span>
            Horse ledger<small>CARE. TRACK. THRIVE.</small>
          </span>
        </a>
        {authenticated && (
          <>
            <p className="nav-caption">Workspace</p>
            <nav ref={nav} aria-label="Primary navigation">
              {navigation.map(([label, href]) => (
                <a
                  href={href}
                  key={href}
                  aria-current={
                    window.location.pathname === href ||
                    (href === "/horses" &&
                      (window.location.pathname === "/" ||
                        window.location.pathname.startsWith("/horses/")))
                      ? "page"
                      : undefined
                  }
                >
                  <Icon name={label.toLowerCase() as IconName} />
                  {label}
                </a>
              ))}
            </nav>
          </>
        )}
        <div className="sidebar-footer">
          <div className="workspace-note">
            <span className="workspace-dot" />
            Your private workspace
          </div>
          {accountControls}
        </div>
      </header>
      <div className="workspace-bar">
        <span>
          Workspace <span aria-hidden="true">/</span>{" "}
          <strong>
            {navigation.find(([, href]) =>
              window.location.pathname.startsWith(href),
            )?.[0] ?? "Horses"}
          </strong>
        </span>
        <span className="workspace-label">Horse ledger</span>
      </div>
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
      <main id="main-content" tabIndex={-1} aria-busy={!authReady}>
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
