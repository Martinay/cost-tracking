import "./styles.css";
import { I18nProvider } from "./i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createApiClient, createAuthSessionBootstrap } from "./api/client";
import { createSubjectQueryLifecycle } from "./api/queryKeys";
import { AuthBoundary } from "./auth/AuthBoundary";
import { HorsesRoute } from "./routes/horses";
import { HorseDetailRoute } from "./routes/horses.$horseId";
import { SettingsRoute } from "./routes/settings";
import { ExpensesRoute } from "./routes/expenses";
import { IncomeRoute } from "./routes/income";
import { ReportsRoute } from "./routes/reports";
import { TasksRoute } from "./routes/tasks";
import { ApprovalsRoute } from "./routes/approvals";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const queryClient = new QueryClient();
const authSession = createAuthSessionBootstrap({ baseUrl: apiBaseUrl });
const apiClient = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: () => authSession.getAccessToken(),
});
const subjectQueryLifecycle = createSubjectQueryLifecycle(
  queryClient,
  apiClient.setSubject,
);

function routeContent() {
  if (window.location.pathname === "/settings") return <SettingsRoute />;
  if (window.location.pathname === "/expenses") return <ExpensesRoute />;
  if (window.location.pathname === "/income") return <IncomeRoute />;
  if (window.location.pathname === "/approvals") return <ApprovalsRoute />;
  if (window.location.pathname === "/reports") return <ReportsRoute />;
  if (window.location.pathname === "/tasks") return <TasksRoute />;
  const horseMatch = window.location.pathname.match(/^\/horses\/([^/]+)\/?$/);
  if (horseMatch)
    return <HorseDetailRoute horseId={decodeURIComponent(horseMatch[1])} />;
  return <HorsesRoute />;
}

export function RootApp() {
  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <AuthBoundary
          apiBaseUrl={apiBaseUrl}
          apiClient={apiClient}
          session={authSession}
          subjectLifecycle={subjectQueryLifecycle}
        >
          {routeContent()}
        </AuthBoundary>
      </QueryClientProvider>
    </I18nProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<RootApp />);
