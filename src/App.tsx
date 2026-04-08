import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./components/sidebar";
import { LoginPage } from "./components/login-page";
import { DashboardPage } from "./components/dashboard-page";
import { ProfilesPage } from "./components/profiles-page";
import { LogPage } from "./components/log-page";
import { useTheme } from "./lib/theme";
import { type Template, type WatchProfile, getProfiles, fetchTemplates } from "./lib/tauri-api";

export type Page = "dashboard" | "profiles" | "logs";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function App() {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<Page>("dashboard");
  const [savedApiKey, setSavedApiKey] = useState<string | null>(null);
  const themeCtx = useTheme();
  const queryClient = useQueryClient();

  const {
    data: templates = [],
    isLoading: loadingTemplates,
    refetch: refreshTemplates,
  } = useQuery({
    queryKey: ["templates"],
    queryFn: () => fetchTemplates(),
    enabled: connected,
  });

  const {
    data: profiles = [],
  } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => getProfiles(),
    enabled: connected,
  });

  useEffect(() => {
    (async () => {
      try {
        if (!isTauri) { setChecking(false); return; }
        const { invoke } = await import("@tauri-apps/api/core");
        const session = await invoke<{ connected: boolean; apiUrl: string; apiKey: string }>("check_saved_session");
        if (session.connected) {
          setConnected(true);
          try {
            const tmpl = await invoke<Template[]>("fetch_templates");
            queryClient.setQueryData(["templates"], tmpl);
          } catch {}
        } else if (session.apiKey) {
          setSavedApiKey(session.apiKey);
        }
      } catch {} finally { setChecking(false); }
    })();
  }, []);

  function handleConnected(session: { apiUrl: string; apiKey: string; templates: Template[] }) {
    setConnected(true);
    queryClient.setQueryData(["templates"], session.templates);
    setPage("dashboard");
  }

  async function handleDisconnect() {
    try {
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("logout");
      }
    } catch {}
    setConnected(false);
    queryClient.clear();
  }

  function handleProfilesChanged(updated: WatchProfile[]) {
    queryClient.setQueryData(["profiles"], updated);
  }
  const handleRefreshTemplates = async () => { await refreshTemplates(); };
  const activeCount = profiles.filter((p) => p.isActive).length;

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--background)", color: "var(--foreground)" }}>
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>接続を確認中...</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return <LoginPage onConnected={handleConnected} savedApiKey={savedApiKey} />;
  }

  return (
    <div className="flex h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Sidebar currentPage={page} onNavigate={setPage} connected={connected}
        activeProfileCount={activeCount} templateCount={templates.length}
        onDisconnect={handleDisconnect} theme={themeCtx} />
      <main className="flex-1 overflow-hidden">
        <div className="page-enter h-full">
          {page === "dashboard" && <DashboardPage profiles={profiles} templates={templates} connected={connected}
            onNavigate={setPage} onProfilesChanged={handleProfilesChanged} onRefreshTemplates={handleRefreshTemplates} loadingTemplates={loadingTemplates} />}
          {page === "profiles" && <ProfilesPage profiles={profiles} templates={templates} connected={connected}
            onProfilesChanged={handleProfilesChanged} onRefreshTemplates={handleRefreshTemplates} loadingTemplates={loadingTemplates} />}
          {page === "logs" && <LogPage profiles={profiles} />}
        </div>
      </main>
    </div>
  );
}
