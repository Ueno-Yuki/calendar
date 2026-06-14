# 家族カレンダー

家族4人（母・父・自分・弟）向けの共有カレンダーアプリ。

Google Sheets をデータベースとして利用し、母のみ Google Calendar と双方向同期する。
ログイン不要で、家族ごとの専用 URL でアクセスする。

---

## 技術スタック

| カテゴリ | 内容 |
|---|---|
| Frontend | Next.js 16.2.9 / TypeScript / Tailwind CSS v4 / Lucide React |
| Backend | Next.js Route Handlers |
| Database | Google Sheets |
| 外部サービス | Google Sheets API / Google Calendar API / Google OAuth2 |
| ホスティング | Vercel |

---

## 実装済み機能

### 認証
- 家族ごとの専用トークン URL によるログイン不要認証
- Cookie による端末保持（以後は自動識別）

### カレンダー
- 月間カレンダー表示（横スワイプで月移動）
- 日別スケジュールモーダル（タイムテーブル形式）
- 複数日予定の横展開・週またぎ分割表示
- 日本の祝日表示（`@holiday-jp/holiday_jp`）

### 予定管理
- 予定作成（タイトル・日時・場所・メモ）
- 予定削除（左スワイプ → 確認モーダル → 論理削除）
- タイトル入力サジェスト（過去予定から候補表示・時間/場所/メモ自動入力）

### UX
- TimeTree 風入力 UI（ホイール時間選択）
- iPhone / Android 対応・ズーム防止
- Lucide アイコン

### Google 連携（PR09 完了後に有効）
- 母のみ Google Calendar 双方向同期
- 初回 OAuth 認証完了時に本日以降の既存予定を一度だけ取り込み
- 以後は 10 分キャッシュで定期同期

---

## ディレクトリ構成

```
src/
  app/
    api/          # Route Handlers（events / auth / sync）
    family/[role] # 家族認証エントリーポイント
    page.tsx      # 月間カレンダー（メイン画面）
  components/
    calendar/     # CalendarGrid / CalendarCell / CalendarHeader 等
    modal/        # DayModal / EventCreateForm
  lib/
    sheets.ts         # Google Sheets API クライアント
    auth.ts           # トークン検証ユーティリティ
    eventsDb.ts       # 予定 CRUD（Sheets 操作）
    calendarUtils.ts  # 月間カレンダー計算ロジック
    colors.ts         # 家族カラー定義
    holidays.ts       # 祝日取得
    apiClient.ts      # クライアント側 fetch ラッパー
  types/
    index.ts      # 型定義（Event / User / SyncMeta 等）
docs/             # 仕様書・設計書
tasks/            # 実装計画
```

---

## 環境変数

`.env.local.example` をコピーして `.env.local` を作成する。

```bash
cp .env.local.example .env.local
```

| 変数名 | 説明 |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | サービスアカウントのメールアドレス |
| `GOOGLE_PRIVATE_KEY` | サービスアカウントの秘密鍵（改行は `\n`） |
| `GOOGLE_SPREADSHEET_ID` | Google Sheets のスプレッドシート ID |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth2 クライアント ID（母の Google Calendar 連携用） |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth2 クライアントシークレット |
| `GOOGLE_CALENDAR_ID_MOTHER` | 母の Google カレンダー ID（通常は Gmail アドレス） |
| `VAPID_PUBLIC_KEY` | Web Push 用 VAPID 公開鍵 |
| `VAPID_PRIVATE_KEY` | Web Push 用 VAPID 秘密鍵 |
| `FAMILY_TOKEN_MOTHER` | 母の認証トークン（長いランダム文字列） |
| `FAMILY_TOKEN_FATHER` | 父の認証トークン |
| `FAMILY_TOKEN_ME` | 自分の認証トークン |
| `FAMILY_TOKEN_BROTHER` | 弟の認証トークン |

> **注意:** `GOOGLE_PRIVATE_KEY` の改行は `\n` リテラルで記述し、値全体をダブルクォートで囲む。
> 母の Google Calendar の Refresh Token は初回 OAuth 認証後に `sync_meta` シートへ自動保存されるため、環境変数には不要。

---

## Google Sheets 構成

スプレッドシート内に以下のシートを手動で作成しておく。

| シート名 | 役割 |
|---|---|
| `users` | 家族メンバー情報・通知設定 |
| `sync_meta` | Google Calendar Refresh Token・同期状態フラグ（`mother_google_refresh_token` / `mother_google_import_completed` / `mother_google_calendar_last_synced_at`）|
| `event_templates` | タイトルサジェスト用の過去予定テンプレート |
| `push_subscriptions` | Web Push の Subscription 情報 |
| `notification_logs` | Push 通知の送信ログ |
| `YYYY-MM`（例: `2026-06`）| 月別の予定データ。予定登録時に自動作成される |

月別シートのカラム構成：

```
id / owner / person / title / start_date / end_date / start_time / end_time
/ location / memo / all_day / source / google_event_id
/ created_at / updated_at / deleted
```

---

## ローカル開発

```bash
npm install
npm run dev
```

`http://localhost:3000` でアプリが起動する。

### 家族認証 URL

各メンバーは以下の URL にアクセスしてアプリを開く。

```
http://localhost:3000/family/mother?token=<FAMILY_TOKEN_MOTHER の値>
http://localhost:3000/family/father?token=<FAMILY_TOKEN_FATHER の値>
http://localhost:3000/family/me?token=<FAMILY_TOKEN_ME の値>
http://localhost:3000/family/brother?token=<FAMILY_TOKEN_BROTHER の値>
```

初回アクセス時に Cookie へユーザー情報が保存され、2 回目以降は URL なしで自動識別される。

---

## Google Cloud 設定

### 有効化する API

Google Cloud Console でプロジェクトを作成し、以下の API を有効化する。

- Google Sheets API
- Google Calendar API

### サービスアカウント設定（Sheets 用）

1. IAM と管理 → サービスアカウント → 作成
2. キーを JSON 形式で発行
3. `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
4. `private_key` → `GOOGLE_PRIVATE_KEY`（改行を `\n` に置換）
5. Google Sheets を開き、サービスアカウントのメールアドレスを「編集者」として共有

### OAuth2 設定（Google Calendar 連携用）

1. API とサービス → OAuth 同意画面 → 外部（テスト用は内部でも可）
2. スコープに `https://www.googleapis.com/auth/calendar` を追加
3. テストユーザーに母の Gmail を追加
4. 認証情報 → OAuth 2.0 クライアント ID を作成
   - アプリケーションの種類: ウェブアプリケーション
   - 承認済みのリダイレクト URI: `https://your-domain.vercel.app/api/auth/google/callback`（ローカルは `http://localhost:3000/api/auth/google/callback`）
5. クライアント ID → `GOOGLE_OAUTH_CLIENT_ID`
6. クライアントシークレット → `GOOGLE_OAUTH_CLIENT_SECRET`

### 母の初回 Google 認証

以下の URL にアクセスして母のアカウントで Google 認証を行う（初回のみ）。

```
https://your-domain.vercel.app/api/auth/google
```

認証完了後、Refresh Token が `sync_meta` シートに自動保存され、以後は自動同期が有効になる。

---

## Vercel デプロイ

### 環境変数の設定

Vercel ダッシュボード → プロジェクト → Settings → Environment Variables に `.env.local` の全変数を登録する。

> `GOOGLE_PRIVATE_KEY` は改行を含む値のため、Vercel の環境変数入力欄に貼り付ける際は `\n` リテラルのままで問題ない（Vercel が自動解釈する）。

### デプロイ

```bash
# Vercel CLI を使う場合
npx vercel --prod

# または GitHub 連携で main ブランチへの push で自動デプロイ
```

### カスタムドメイン設定

1. Vercel ダッシュボード → プロジェクト → Settings → Domains
2. 取得済みドメインを追加
3. DNS に CNAME または A レコードを設定
4. Google Cloud Console の OAuth リダイレクト URI にカスタムドメインを追加

---

## 今後の実装予定

| PR | 内容 |
|---|---|
| PR10 | PWA 対応・Service Worker 基盤・Push Subscription |
| PR11 | 通知設定モーダル（通知全体・予定追加・予定削除・デイリー通知の ON/OFF） |
| PR12 | 即時 Push 通知（予定追加・削除時に家族へ通知） |
| PR13 | 今日の予定通知（Vercel Cron による Daily Summary） |

詳細は `tasks/implementation-plan.md` を参照。

---

## ライセンス

Private Project
