import { useState } from "react";
import {
  type Template,
  type WatchProfile,
  type ProfileFormData,
  isTauri,
  createProfile,
  toggleProfileActive,
} from "../lib/tauri-api";

interface SetupWizardProps {
  templates: Template[];
  onComplete: (profile: WatchProfile) => void;
  onSkip: () => void;
  onRefreshTemplates: () => Promise<void>;
  loadingTemplates: boolean;
}

async function selectFolder(): Promise<string | null> {
  if (!isTauri) return "C:\\Demo\\Folder";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return selected as string | null;
}

export function SetupWizard({ templates, onComplete, onSkip, onRefreshTemplates, loadingTemplates }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [inputFolder, setInputFolder] = useState("");
  const [outputFolder, setOutputFolder] = useState("");
  const [processedFolder, setProcessedFolder] = useState("");
  const [profileName, setProfileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canNext1 = selectedTemplate !== null;
  const canNext2 = inputFolder !== "" && outputFolder !== "" && processedFolder !== "";

  function handleNext() {
    if (step === 1 && canNext1) {
      if (!profileName) setProfileName(selectedTemplate!.name);
      setStep(2);
    } else if (step === 2 && canNext2) {
      setStep(3);
    }
  }

  function handleBack() {
    if (step > 1) setStep(step - 1);
  }

  async function handleSelectFolder(setter: (v: string) => void) {
    try {
      const path = await selectFolder();
      if (path) setter(path);
    } catch {
      const path = prompt("フォルダパスを入力:");
      if (path) setter(path);
    }
  }

  async function handleFinish() {
    if (!selectedTemplate) return;
    setSaving(true);
    setSaveError(null);
    try {
      const data: ProfileFormData = {
        name: profileName || selectedTemplate.name,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
        inputFolder,
        outputFolder,
        processedFolder,
        csvEncoding: "utf-8-bom",
        outputCycle: "none",
        pollingIntervalSeconds: 5,
      };
      const created = await createProfile(data);
      await toggleProfileActive(created.id, true);
      onComplete({ ...created, isActive: true });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  const stepTitles = ["帳票の種類を選ぶ", "フォルダを設定する", "設定名を決めて開始"];

  return (
    <div className="flex h-screen items-center justify-center" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="w-full max-w-lg px-4">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold"
                style={{
                  background: s <= step ? "var(--primary)" : "var(--secondary)",
                  color: s <= step ? "var(--primary-foreground)" : "var(--muted-foreground)",
                }}
              >
                {s < step ? "\u2713" : s}
              </div>
              {s < 3 && (
                <div
                  className="w-8 h-0.5"
                  style={{ background: s < step ? "var(--primary)" : "var(--border)" }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-xl border p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <h1 className="text-lg font-semibold tracking-tight mb-1">{stepTitles[step - 1]}</h1>

          {/* ===== Step 1: Template selection ===== */}
          {step === 1 && (
            <>
              <p className="text-sm mb-4" style={{ color: "var(--muted-foreground)" }}>
                どの帳票を自動処理しますか？
              </p>

              {templates.length === 0 ? (
                <div className="rounded-lg border px-4 py-6 text-center" style={{ borderColor: "var(--border)" }}>
                  <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                    帳票テンプレートがありません。Web管理画面でテンプレートを作成してください。
                  </p>
                  <button
                    type="button"
                    onClick={() => void onRefreshTemplates()}
                    disabled={loadingTemplates}
                    className="mt-3 rounded-lg border px-4 py-2 text-sm font-medium transition"
                    style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                  >
                    {loadingTemplates ? "取得中..." : "更新"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2 max-h-64 overflow-auto">
                    {templates.map((t) => {
                      const isSelected = selectedTemplate?.id === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedTemplate(t)}
                          className="w-full rounded-lg border p-3 text-left transition"
                          style={{
                            borderColor: isSelected ? "var(--primary)" : "var(--border)",
                            background: isSelected ? "oklch(from var(--primary) l c h / 0.06)" : "var(--background)",
                            boxShadow: isSelected ? "0 0 0 1px var(--primary)" : "none",
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{t.name}</span>
                            <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                              {t.fieldCount}項目
                            </span>
                          </div>
                          {t.description && (
                            <p className="mt-1 text-xs" style={{ color: "var(--muted-foreground)" }}>
                              {t.description}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void onRefreshTemplates()}
                      disabled={loadingTemplates}
                      className="text-[11px] font-medium"
                      style={{ color: "var(--sidebar-primary)" }}
                    >
                      {loadingTemplates ? "取得中..." : "テンプレートを更新"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ===== Step 2: Folder selection ===== */}
          {step === 2 && (
            <>
              <p className="text-sm mb-4" style={{ color: "var(--muted-foreground)" }}>
                PDFの入力元と、CSV出力先のフォルダを設定します。
              </p>

              <div className="space-y-4">
                {([
                  { label: "PDFを入れるフォルダ（入力）", desc: "このフォルダにPDFを入れると自動で処理されます", value: inputFolder, setter: setInputFolder },
                  { label: "CSVを出力するフォルダ（出力）", desc: "抽出結果のCSVファイルがここに保存されます", value: outputFolder, setter: setOutputFolder },
                  { label: "処理済みPDFの移動先フォルダ", desc: "処理が終わったPDFはここに移動されます", value: processedFolder, setter: setProcessedFolder },
                ] as const).map((item) => (
                  <div key={item.label}>
                    <label className="mb-1 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                      {item.label}
                    </label>
                    <p className="mb-1.5 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      {item.desc}
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={item.value}
                        readOnly
                        placeholder="フォルダを選択..."
                        className="flex-1 rounded-lg border px-3 py-2 text-sm"
                        style={{ background: "var(--secondary)", borderColor: "var(--input)", color: "var(--foreground)" }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSelectFolder(item.setter)}
                        className="rounded-lg border px-3 py-2 text-sm font-medium transition"
                        style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                      >
                        参照
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ===== Step 3: Name & Confirm ===== */}
          {step === 3 && (
            <>
              <p className="text-sm mb-4" style={{ color: "var(--muted-foreground)" }}>
                設定内容を確認して、自動処理を開始しましょう。
              </p>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                    設定名
                  </label>
                  <input
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder={selectedTemplate?.name ?? ""}
                    className="w-full rounded-lg border px-3 py-2 text-sm transition focus:outline-none focus:ring-2"
                    style={{ background: "var(--background)", borderColor: "var(--input)", color: "var(--foreground)" }}
                  />
                </div>

                {/* Summary */}
                <div className="rounded-lg border p-3 space-y-2 text-sm" style={{ background: "var(--background)", borderColor: "var(--border)" }}>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--muted-foreground)" }}>帳票</span>
                    <span className="font-medium">{selectedTemplate?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--muted-foreground)" }}>入力</span>
                    <span className="font-medium truncate max-w-[240px]">{inputFolder}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--muted-foreground)" }}>出力</span>
                    <span className="font-medium truncate max-w-[240px]">{outputFolder}</span>
                  </div>
                  <div className="flex justify-between">
                    <span style={{ color: "var(--muted-foreground)" }}>処理済み</span>
                    <span className="font-medium truncate max-w-[240px]">{processedFolder}</span>
                  </div>
                </div>

                {saveError && (
                  <div className="rounded-lg px-3 py-2.5 text-sm"
                    style={{ background: "oklch(0.577 0.245 27.325 / 0.1)", color: "var(--destructive)" }}>
                    作成に失敗しました: {saveError}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Navigation buttons */}
          <div className="mt-6 flex items-center justify-between">
            <div>
              {step > 1 ? (
                <button
                  type="button"
                  onClick={handleBack}
                  className="rounded-lg border px-4 py-2 text-sm font-medium transition"
                  style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
                >
                  戻る
                </button>
              ) : (
                <span />
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onSkip}
                className="text-xs font-medium"
                style={{ color: "var(--muted-foreground)" }}
              >
                後で設定する
              </button>
              {step < 3 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={step === 1 ? !canNext1 : !canNext2}
                  className="rounded-lg px-5 py-2 text-sm font-medium transition disabled:opacity-50"
                  style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                >
                  次へ
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleFinish()}
                  disabled={saving}
                  className="rounded-lg px-5 py-2 text-sm font-medium transition disabled:opacity-50"
                  style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                >
                  {saving ? "作成中..." : "自動処理を開始する"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
