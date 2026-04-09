import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./components/sidebar";
import { LoginPage } from "./components/login-page";
import { DashboardPage } from "./components/dashboard-page";
import { ProfilesPage } from "./components/profiles-page";
import { LogPage } from "./components/log-page";
import { UsagePage } from "./components/usage-page";
import { useTheme } from "./lib/theme";
import { type Template, type WatchProfile, getProfiles, fetchTemplates } from "./lib/tauri-api";

export type Page = "dashboard" | "profiles" | "logs" | "usage";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function App() {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState<Page>("dashboard");
  const [savedApiKey, setSavedApiKey] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
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

  // Listen for update-available event from Rust backend
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ version: string }>("update-available", (event) => {
          setUpdateAvailable(event.payload);
        });
      } catch { /* update listener setup may fail in non-Tauri env */ }
    })();
    return () => { unlisten?.(); };
  }, []);

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
          } catch { /* template prefetch failure is non-critical */ }
        } else if (session.apiKey) {
          setSavedApiKey(session.apiKey);
        }
      } catch { /* session check expected to fail when not configured */ } finally { setChecking(false); }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } catch { /* logout may fail if not in Tauri env */ }
    setConnected(false);
    queryClient.clear();
  }

  function handleProfilesChanged(updated: WatchProfile[]) {
    queryClient.setQueryData(["profiles"], updated);
  }
  const handleRefreshTemplates = async () => { await refreshTemplates(); };
  const activeCount = profiles.filter((p) => p.isActive).length;

  async function handleInstallUpdate() {
    if (!isTauri || updating) return;
    setUpdating(true);
    setUpdateError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_update");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Update failed:", msg);
      setUpdateError(msg);
      setUpdating(false);
    }
  }

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
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* 更新通知バナー */}
        {updateAvailable && (
          <div className="px-4 py-2 text-sm" style={{ background: updateError ? "oklch(0.577 0.245 27.325 / 0.1)" : "oklch(0.488 0.243 264.376 / 0.1)", borderBottom: `1px solid ${updateError ? "oklch(0.577 0.245 27.325 / 0.2)" : "oklch(0.488 0.243 264.376 / 0.2)"}` }}>
            <div className="flex items-center justify-between">
              <span>
                <span className="font-semibold" style={{ color: "oklch(0.488 0.243 264.376)" }}>v{updateAvailable.version}</span>
                <span style={{ color: "var(--muted-foreground)" }}> が利用可能です</span>
              </span>
              <div className="flex items-center gap-2">
                <button onClick={() => { setUpdateAvailable(null); setUpdateError(null); }} className="rounded px-2 py-1 text-xs" style={{ color: "var(--muted-foreground)" }}>後で</button>
                <button onClick={handleInstallUpdate} disabled={updating}
                  className="rounded-md px-3 py-1 text-xs font-medium text-white transition"
                  style={{ background: "oklch(0.488 0.243 264.376)" }}>
                  {updating ? "更新中..." : updateError ? "再試行" : "今すぐ更新"}
                </button>
              </div>
            </div>
            {updateError && (
              <p className="mt-1 text-[11px]" style={{ color: "var(--destructive)" }}>更新エラー: {updateError}</p>
            )}
          </div>
        )}
        <div className="page-enter flex-1 overflow-hidden">
          {page === "dashboard" && <DashboardPage profiles={profiles} templates={templates} connected={connected}
            onNavigate={setPage} onProfilesChanged={handleProfilesChanged} onRefreshTemplates={handleRefreshTemplates} loadingTemplates={loadingTemplates} />}
          {page === "profiles" && <ProfilesPage profiles={profiles} templates={templates} connected={connected}
            onProfilesChanged={handleProfilesChanged} onRefreshTemplates={handleRefreshTemplates} loadingTemplates={loadingTemplates} />}
          {page === "logs" && <LogPage profiles={profiles} />}
          {page === "usage" && <UsagePage />}
        </div>
      </main>
    </div>
  );
}
