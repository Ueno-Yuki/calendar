# 家族カレンダー PWA

スマートフォン利用を前提にした、家族向けの共有カレンダーアプリです。  
見やすさ、入力の速さ、通知の実用性を優先して設計しています。

---

## Overview

家族内の予定共有を、できるだけ迷わず使える月間カレンダー体験に落とし込んだ PWA です。

- 月間カレンダーを中心にした単一画面構成
- 予定作成、編集、削除
- 複数日予定の表示
- 家族ごとの色分け
- Push 通知
- Google Sheets をバックエンドとして利用
- Google Calendar との選択的な同期

想定ユーザーは非エンジニアを含む家庭内利用者で、PC よりもスマホ操作を優先しています。

---

## What This Project Solves

一般的なカレンダーアプリは機能が多い一方で、家族内の共有には操作が重くなりやすいです。  
このアプリでは以下を重視しています。

- ひと目で把握できる月間表示
- 入力項目を絞った予定登録
- 家族ごとの予定の識別しやすさ
- 通知と同期の挙動を明示的に制御できること
- API 障害時にも予定が消えたように見えにくいこと

---

## Key Features

### Calendar UX

- 月間カレンダー表示
- 横スワイプで前月 / 翌月へ移動
- 日別モーダルで予定一覧と編集導線を集約
- 今日セルのハイライト
- 祝日表示
- 複数日予定バー表示

### Event Management

- 予定作成
- 予定編集
- 論理削除
- タイトル候補サジェスト
- 特定タイトルに応じた業務向け時刻入力拡張

### Notifications

- Web Push 通知
- Daily Summary
- お休みモード
- 通知ログ記録

### Google Integration

- Google Calendar からの取り込み
- アプリ予定の Google Calendar への逆同期
- 同期対象の色 / カテゴリ制御
- プレビュー付きの手動同期

---

## Technical Highlights

### 1. Google Sheets をデータストアとして採用

RDB ではなく Google Sheets を採用し、運用者が内容を直接確認できる構成にしています。  
一方で、配列順依存による列ズレや API 一時失敗の扱いなど、運用系の課題が出やすいため、以下を実装しています。

- ヘッダー名ベースの書き込み
- 月別シート自動作成
- 論理削除
- 失敗時と「予定なし」の分離
- 読み取りリトライ

### 2. モバイル前提の状態管理

月移動、Pull To Refresh、同期後再取得、通知経由の deep link など、複数の画面遷移経路があります。  
そのため、単純な初回 fetch ではなく、以下のような設計を入れています。

- in-memory cache
- localStorage ベースの月別キャッシュ
- 強制再取得と通常表示の分離
- fetch 成功時のみ state / cache 更新

### 3. Google 同期の安全性

Google Calendar 取り込みは即時反映ではなく、プレビュー後に対象を選択して実行する設計です。

- 取り込み候補のプレビュー
- 色 / カテゴリによる対象制御
- 既存予定との重複除外
- 逆同期時の候補分類
- Google 側と Sheets 側の反映順制御

---

## Architecture

```text
Google Calendar (optional, role-limited)
        |
Google Calendar API / OAuth2
        |
Next.js Route Handlers
        |
Google Sheets
        |
Next.js PWA
```

---

## Stack

| Category | Tech |
|---|---|
| Frontend | Next.js 16 / TypeScript / Tailwind CSS v4 |
| UI | Lucide React |
| Backend | Next.js Route Handlers |
| Data Store | Google Sheets |
| External APIs | Google Sheets API / Google Calendar API / Web Push |
| Hosting | Vercel |

---

## Reliability Notes

このアプリでは、単に「取得できたら表示」ではなく、利用者視点で予定が消えたように見えないことを優先しています。

現在の対策:

- Sheets 読み取り失敗時に `予定なし` として扱わない
- 月別ローカルキャッシュを先に表示
- 裏で再取得し、成功時だけ差し替え
- 更新ボタン / Pull To Refresh は force fetch
- Google 同期失敗時の詳細ログ出力

---

## Directory Structure

```text
src/
  app/
    api/              # Route Handlers
    family/[role]/    # family-specific entry points
    page.tsx          # main monthly calendar screen
  components/
    calendar/         # grid, rows, header
    modal/            # day modal, event form, settings
  lib/
    sheets.ts         # Google Sheets access
    googleCalendar.ts # Google Calendar client
    googleCalendarSync.ts
    eventsDb.ts
    calendarUtils.ts
    apiClient.ts
  types/
    index.ts
docs/
  00_project/
```

---

## Local Development

```bash
npm install
npm run dev
```

ローカル起動後:

```text
http://localhost:3000
```

このアプリは family-specific URL による識別を前提にしています。  
必要な環境変数は `.env.local.example` を参照してください。

```bash
cp .env.local.example .env.local
```

---

## Environment Notes

このプロジェクトは以下のカテゴリの設定を利用します。

- Google Sheets API credentials
- Google OAuth credentials
- Google Calendar target settings
- Web Push VAPID keys
- family-specific access tokens

実値は README には記載していません。  
Private repository 内でも、秘密情報は `.env.local` / Vercel Environment Variables で管理してください。

---

## Product Constraints

このアプリは MVP として、以下を意図的にスコープ外にしています。

- 汎用的なユーザー管理
- 複数グループ対応
- 検索
- CSV 出力
- LINE 連携
- 高度な権限制御
