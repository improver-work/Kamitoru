import { useState } from "react";
import { type WatchProfile, type Template, type ProfileFormData, createProfile, updateProfile, deleteProfile } from "../lib/tauri-api";

interface ProfilesPageProps {
  profiles: WatchProfile[];
  templates: Template[];
  connected: boolean;
  onProfilesChanged: (profiles: WatchProfile[]) => void;
  onRefreshTemplates: () => Promise<void>;
  loadingTemplates: boolean;
}

type Mode = "list" | "create" | "edit";

const EMPTY_FORM: ProfileFormData = {
  name: "", templateId: "", templateName: "",
  inputFolder: "", outputFolder: "", processedFolder: "",
  csvEncoding: "utf-8-bom", outputCycle: "none", pollingIntervalSeconds: 5,
};

export function ProfilesPage({ profiles, templates, connected, onProfilesChanged, onRefreshTemplates, loadingTemplates }: ProfilesPageProps) {
  const [mode, setMode] = useState<Mode>("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleCreate() { setForm(EMPTY_FORM); setEditId(null); setMode("create"); }

  function handleEdit(p: WatchProfile) {
    setForm({
      name: p.name, templateId: p.templateId, templateName: p.templateName,
      inputFolder: p.inputFolder, outputFolder: p.outputFolder, processedFolder: p.processedFolder,
      csvEncoding: p.csvEncoding, outputCycle: p.outputCycle, pollingIntervalSeconds: p.pollingIntervalSeconds,
    });
    setEditId(p.id); setMode("edit");
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === "create") {
        const created = await createProfile(form);
        onProfilesChanged([...profiles, created]);
      } else if (editId) {
        const updated = await updateProfile(editId, form);
        onProfilesChanged(profiles.map((p) => (p.id === editId ? updated : p)));
      }
      setMode("list");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("この設定を削除しますか?")) return;
    try {
      await deleteProfile(id);
      onProfilesChanged(profiles.filter((p) => p.id !== id));
    } catch (err) {
      alert("削除に失敗しました: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  function handleTemplateChange(tid: string) {
    const t = templates.find((x) => x.id === tid);
    setForm({ ...form, templateId: tid, templateName: t?.name ?? "" });
  }

  async function handleSelectFolder(field: "inputFolder" | "outputFolder" | "processedFolder") {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (selected) setForm({ ...form, [field]: selected as string });
    } catch {
      const path = prompt("フォルダパスを入力:");
      if (path) setForm({ ...form, [field]: path });
    }
  }

  const inputStyle = {
    background: "var(--background)", borderColor: "var(--input)", color: "var(--foreground)",
  };

  // ===== List View =====
  if (mode === "list") {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">自動処理の設定</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>自動処理の設定を管理</p>
          </div>
          <button onClick={handleCreate} disabled={!connected}
            className="rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
            + 新規作成
          </button>
        </div>

        {!connected && (
          <div className="mb-4 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "oklch(0.8 0.1 85)", background: "oklch(0.8 0.1 85 / 0.1)", color: "oklch(0.6 0.15 85)" }}>
            API接続を完了してからプロファイルを作成してください
          </div>
        )}

        {profiles.length === 0 ? (
          <div className="rounded-xl p-10 text-center border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>設定がまだありません</p>
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map((p) => (
              <div key={p.id} className="group rounded-xl p-4 border transition-all"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{p.name}</h3>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          background: p.isActive ? "oklch(0.6 0.15 155 / 0.1)" : "var(--secondary)",
                          color: p.isActive ? "oklch(0.6 0.15 155)" : "var(--muted-foreground)",
                        }}>
                        {p.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ background: "oklch(0.488 0.243 264.376 / 0.1)", color: "oklch(0.488 0.243 264.376)" }}>
                        {p.templateName}
                      </span>
                      <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{p.csvEncoding} / {p.pollingIntervalSeconds}s</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-3 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      <div><span className="font-medium" style={{ color: "var(--foreground)" }}>入力</span><p className="mt-0.5 truncate">{p.inputFolder}</p></div>
                      <div><span className="font-medium" style={{ color: "var(--foreground)" }}>出力</span><p className="mt-0.5 truncate">{p.outputFolder}</p></div>
                      <div><span className="font-medium" style={{ color: "var(--foreground)" }}>処理済</span><p className="mt-0.5 truncate">{p.processedFolder}</p></div>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => handleEdit(p)} className="rounded-lg px-2.5 py-1 text-xs font-medium"
                      style={{ color: "var(--muted-foreground)" }}>編集</button>
                    <button onClick={() => handleDelete(p.id)} className="rounded-lg px-2.5 py-1 text-xs font-medium"
                      style={{ color: "var(--destructive)" }}>削除</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ===== Create / Edit Form =====
  const isValid = form.name && form.templateId && form.inputFolder && form.outputFolder && form.processedFolder;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-xl">
        <button onClick={() => setMode("list")} className="mb-3 text-xs font-medium" style={{ color: "var(--sidebar-primary)" }}>
          &larr; 一覧に戻る
        </button>
        <h1 className="mb-5 text-lg font-semibold tracking-tight">
          {mode === "create" ? "新規作成" : "設定の編集"}
        </h1>

        <div className="space-y-4 rounded-xl p-5 border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>設定名</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例: 請求書自動処理"
              className="w-full rounded-lg border px-3 py-2 text-sm transition focus:outline-none focus:ring-2"
              style={inputStyle} />
          </div>

          {/* Template */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>帳票の種類</label>
              <button
                type="button"
                onClick={() => void onRefreshTemplates()}
                disabled={loadingTemplates}
                className="text-[11px] font-medium"
                style={{ color: "var(--sidebar-primary)" }}
              >
                {loadingTemplates ? "取得中..." : "更新"}
              </button>
            </div>
            <select value={form.templateId} onChange={(e) => handleTemplateChange(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
              <option value="">
                {loadingTemplates ? "帳票の種類を取得中..." : templates.length === 0 ? "帳票の種類なし（更新を押してください）" : "選択してください"}
              </option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.fieldCount}項目)</option>
              ))}
            </select>
          </div>

          {/* Folders */}
          {(["inputFolder", "outputFolder", "processedFolder"] as const).map((field) => {
            const labels = { inputFolder: "入力フォルダ（監視対象）", outputFolder: "出力フォルダ（CSV保存先）", processedFolder: "処理済みフォルダ" };
            return (
              <div key={field}>
                <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>{labels[field]}</label>
                <div className="flex gap-2">
                  <input value={form[field]} readOnly placeholder="フォルダを選択..."
                    className="flex-1 rounded-lg border px-3 py-2 text-sm" style={{ ...inputStyle, background: "var(--secondary)" }} />
                  <button onClick={() => handleSelectFolder(field)}
                    className="rounded-lg border px-3 py-2 text-sm font-medium transition"
                    style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>参照</button>
                </div>
              </div>
            );
          })}

          {/* CSV Settings */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>文字コード</label>
              <select value={form.csvEncoding}
                onChange={(e) => setForm({ ...form, csvEncoding: e.target.value as ProfileFormData["csvEncoding"] })}
                className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
                <option value="utf-8-bom">UTF-8 BOM（Excel向け・おすすめ）</option>
                <option value="utf-8">UTF-8（プログラム連携向け）</option>
                <option value="shift_jis">Shift-JIS（古いシステム向け）</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>CSVのまとめ方</label>
              <select value={form.outputCycle}
                onChange={(e) => setForm({ ...form, outputCycle: e.target.value as ProfileFormData["outputCycle"] })}
                className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
                <option value="none">1件ずつ</option>
                <option value="hourly">1時間ごと</option>
                <option value="daily">1日ごと</option>
                <option value="weekly">1週間ごと</option>
              </select>
            </div>
          </div>

          {/* Polling */}
          <div>
            <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>フォルダの確認間隔（秒）</label>
            <input type="number" min={1} max={300} value={form.pollingIntervalSeconds}
              onChange={(e) => setForm({ ...form, pollingIntervalSeconds: Number(e.target.value) })}
              className="w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
          </div>

          {/* Error */}
          {saveError && (
            <div className="rounded-lg px-3 py-2.5 text-sm"
              style={{ background: "oklch(0.577 0.245 27.325 / 0.1)", color: "var(--destructive)" }}>
              保存に失敗しました: {saveError}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={!isValid || saving}
              className="flex-1 rounded-lg py-2.5 text-sm font-medium transition disabled:opacity-50"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              {saving ? "保存中..." : mode === "create" ? "作成" : "更新"}
            </button>
            <button onClick={() => setMode("list")}
              className="rounded-lg border px-5 py-2.5 text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>キャンセル</button>
          </div>
        </div>
      </div>
    </div>
  );
}
