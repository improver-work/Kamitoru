# PRJ-007: PDF帳票抽出 デスクトップ連携クライアント

PRJ-002のAPI連携機能を活用した、Windows向けデスクトップクライアント。
フォルダにPDFを入れるだけで、自動的にデータ抽出しCSVを出力する。

## セットアップ

### 前提条件

1. **Node.js 24+** (インストール済み)
2. **Rust toolchain** (未インストールの場合は以下を実行)

```bash
# Rust のインストール (Windows)
# https://rustup.rs/ からインストーラーをダウンロード
# または PowerShell で:
winget install Rustlang.Rustup

# Visual Studio Build Tools (C++ workload)
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

### インストール

```bash
cd projects/PRJ-007/app

# フロントエンド依存パッケージ
npm install

# フロントエンド開発サーバー (ブラウザで確認可能)
npm run dev

# Tauri デスクトップアプリとして起動 (Rust必要)
npm run tauri dev

# ビルド (インストーラー生成)
npm run tauri build
```

### フロントエンド単体開発

Rust未インストールでもフロントエンドの開発は可能:

```bash
npm run dev
# http://localhost:1420 でブラウザアクセス
# Tauri APIはモックデータを返却
```

## PRJ-002 API接続

1. PRJ-002のWebアプリにログイン
2. 設定 → APIキー管理 → 新規APIキー発行
3. デスクトップクライアントの設定画面でAPI URLとキーを入力
4. 接続テストで疎通確認

## 技術スタック

- **Tauri v2** (Rust + WebView)
- **React 19** + TypeScript + Vite
- **Tailwind CSS v4** + shadcn/ui
- **TanStack Query** (API通信)
- **SQLite** (ローカル設定・ログ)
