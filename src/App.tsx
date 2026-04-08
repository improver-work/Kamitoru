import { useState, useEffect, useCallback } from "react";
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
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profiles, setProfiles] = useState<WatchProfile[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [savedApiKey, setSavedApiKey] = useState<string | null>(null);
  const themeCtx = useTheme();

  useEffect(() => {
    (async () => {
      try {
        if (!isTauri) { setChecking(false); return; }
        const { invoke } = await import("@tauri-apps/api/core");
        const session = await invoke<{ connected: boolean; apiUrl: string; apiKey: string }>("check_saved_session");
        if (session.connected) {
          setConnected(true);
          try { setTemplates(await invoke<Template[]>("fetch_templates")); } catch {}
          try { setProfiles(await invoke<WatchProfile[]>("get_profiles")); } catch {}
        } else if (session.apiKey) {
          setSavedApiKey(session.apiKey);
        }
      } catch {} finally { setChecking(false); }
    })();
  }, []);

  useEffect(() => {
    if (connected) void getProfiles().then(setProfiles).catch(() => {});
  }, [connected]);

  const refreshTemplates = useCallback(async () => {
    if (!connected) return;
    setLoadingTemplates(true);
    try { setTemplates(await fetchTemplates()); } catch {} finally { setLoadingTemplates(false); }
  }, [connected]);

  function handleConnected(session: { apiUrl: string; apiKey: string; templates: Template[] }) {
    setConnected(true);
    setTemplates(session.templates);
    setPage("dashboard");
    void getProfiles().then(setProfiles).catch(() => {});
  }

  async function handleDisconnect() {
    try {
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("logout");
      }
    } catch {}
    setConnected(false);
    setTemplates([]);
    setProfiles([]);
  }

  function handleProfilesChanged(updated: WatchProfile[]) { setProfiles(updated); }
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
            onNavigate={setPage} onProfilesChanged={handleProfilesChanged} onRefreshTemplates={refreshTemplates} loadingTemplates={loadingTemplates} />}
          {page === "profiles" && <ProfilesPage profiles={profiles} templates={templates} connected={connected}
            onProfilesChanged={handleProfilesChanged} onRefreshTemplates={refreshTemplates} loadingTemplates={loadingTemplates} />}
          {page === "logs" && <LogPage profiles={profiles} />}
        </div>
      </main>
    </div>
  );
}
