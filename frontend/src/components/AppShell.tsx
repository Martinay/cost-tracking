import { useI18n } from "../i18n/I18nProvider";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { LanguageSelector } from "./LanguageSelector";
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
  const { t } = useI18n();
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
        {t("Skip to content")}
      </a>
      <header className="sidebar">
        <a className="brand" href="/horses" aria-label={t("Horse ledger home")}>
          <span className="brand-mark">
            <Icon name="horses" />
          </span>
          <span>
            {t("Horse ledger")}
            <small>{t("CARE. TRACK. THRIVE.")}</small>
          </span>
        </a>
        {authenticated && (
          <>
            <p className="nav-caption">{t("Workspace")}</p>
            <nav ref={nav} aria-label={t("Primary navigation")}>
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
                  {t(label)}
                </a>
              ))}
            </nav>
          </>
        )}
        <div className="sidebar-footer">
          <div className="workspace-note">
            <span className="workspace-dot" />
            {t("Your private workspace")}
          </div>
          <LanguageSelector />
          {accountControls}
        </div>
      </header>
      <div className="workspace-bar">
        <span>
          {t("Workspace ")}
          <span aria-hidden="true">/</span>{" "}
          <strong>
            {t(
              navigation.find(([, href]) =>
                window.location.pathname.startsWith(href),
              )?.[0] ?? "Horses",
            )}
          </strong>
        </span>
        <span className="workspace-label">{t("Horse ledger")}</span>
      </div>
      {!authReady && <p role="status">{t("Loading your account…")}</p>}
      {authReady && !subject && (
        <p role="status">{t("Sign in to open your private horse ledger.")}</p>
      )}
      {statusMessage && (
        <p
          role={statusKind === "assertive" ? "alert" : "status"}
          aria-live={statusKind}
        >
          {t(statusMessage)}
        </p>
      )}
      <main id="main-content" tabIndex={-1} aria-busy={!authReady}>
        {subject !== null && !authReady && authFallback}
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
