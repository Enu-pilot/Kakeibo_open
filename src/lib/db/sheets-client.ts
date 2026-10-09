/**
 * Google Sheets API の最小限のクライアント。
 *
 * googleapis パッケージは大きい（数十 MB）ので使わず、REST を直接呼ぶ。
 * サービスアカウントの認証は、既に依存にある jose で JWT を署名して行う。
 *
 * 認証情報は次のどれかで渡す（上から順に使う）:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  鍵 JSON の中身そのもの（Codespaces のシークレット向け）
 *   GOOGLE_SERVICE_ACCOUNT_FILE  鍵 JSON ファイルのパス（PC 向け）
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL ＋ GOOGLE_PRIVATE_KEY
 *                                以前の「シート」画面の設定方法。そのまま使えるように残している
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SignJWT, importPKCS8 } from "jose";

/** アプリのデータ（GOOGLE_SHEETS_ID）を読み書きするためのスコープ */
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
/** 請求シートなど、ほかのスプレッドシートを読むだけのスコープ。書き込みは構造上できない */
const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/** テスト用に差し替えられるようにしている。通常は既定値のまま */
function apiBase() {
  return process.env.GOOGLE_SHEETS_API_BASE ?? "https://sheets.googleapis.com";
}
function tokenUrl() {
  return process.env.GOOGLE_OAUTH_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
}

/** 画面や CLI にそのまま出せる、直し方つきのエラー */
export class SheetsError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
    this.name = "SheetsError";
  }
}

type ServiceAccount = { client_email: string; private_key: string };

export function spreadsheetId() {
  const raw = process.env.GOOGLE_SHEETS_ID?.trim();
  if (!raw) {
    throw new SheetsError(
      "GOOGLE_SHEETS_ID が未設定です。.env と .env.local にスプレッドシートの ID を設定してください" +
        "（npm run setup:env -- --sheet <スプレッドシートの URL> で設定できます）。",
    );
  }
  // URL を丸ごと貼られても ID を取り出せるようにする
  return raw.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? raw;
}

const CODESPACES_SECRET_HINT = [
  "次を確かめてください:",
  "  1. シークレットを登録したあと、Codespace を一度停止して起動し直したか（ターミナルを開き直すだけでは届きません）",
  "  2. 登録先が「Codespaces」のシークレットか（「Actions」のシークレットは Codespaces に届きません）",
  "  3. 名前が GOOGLE_SERVICE_ACCOUNT_JSON と完全に同じか、対象リポジトリにこのリポジトリが入っているか",
].join("\n");

export function loadServiceAccount(): ServiceAccount {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();

  const legacyEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const legacyKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

  let text: string;
  let source: string;
  // turbopackIgnore の理由は下の resolve と同じ
  const filePath = file ? resolve(/* turbopackIgnore: true */ process.cwd(), file) : null;
  if (!inline && (!filePath || !existsSync(filePath)) && legacyEmail && legacyKey) {
    return { client_email: legacyEmail, private_key: legacyKey.replace(/\\n/g, "\n") };
  }
  if (inline) {
    // 改行を含む JSON を環境変数に入れにくい場合に備え、base64 でも受け付ける
    text = inline.startsWith("{") ? inline : Buffer.from(inline, "base64").toString("utf8");
    source = "GOOGLE_SERVICE_ACCOUNT_JSON";
  } else if (file) {
    // 鍵のパスは実行時に決まる。ビルド時にこの読み込みを辿るとプロジェクト全体が
    // 追跡対象になってしまう（Turbopack の警告）ので、追跡から外す
    const path = resolve(/* turbopackIgnore: true */ process.cwd(), file);
    try {
      text = readFileSync(path, "utf8");
    } catch {
      // Codespaces ではシークレットで渡すのが前提なので、ファイルが無いのは
      // 「シークレットが届いていない」ことのほうが多い。そちらの確かめ方を先に出す
      throw new SheetsError(
        process.env.CODESPACES === "true"
          ? `Codespaces のシークレット GOOGLE_SERVICE_ACCOUNT_JSON が見つかりません（鍵ファイル ${path} もありません）。\n` +
              CODESPACES_SECRET_HINT
          : `サービスアカウントの鍵ファイルが見つかりません: ${path}\n` +
              "Google Cloud からダウンロードした JSON をこの場所に置いてください。",
      );
    }
    source = path;
  } else if (process.env.CODESPACES === "true") {
    throw new SheetsError(
      "Codespaces のシークレット GOOGLE_SERVICE_ACCOUNT_JSON が見つかりません。\n" + CODESPACES_SECRET_HINT,
    );
  } else {
    throw new SheetsError(
      "サービスアカウントの鍵が設定されていません。" +
        ".env に GOOGLE_SERVICE_ACCOUNT_FILE（鍵ファイルのパス）か " +
        "GOOGLE_SERVICE_ACCOUNT_JSON（鍵の中身）を設定してください。",
    );
  }

  let parsed: Partial<ServiceAccount> & { type?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SheetsError(`サービスアカウントの鍵を JSON として読めません（${source}）。`);
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new SheetsError(
      `サービスアカウントの鍵に client_email か private_key がありません（${source}）。` +
        "「サービス アカウント」→「鍵」→「鍵を追加」で作った JSON を使ってください。",
    );
  }
  return {
    client_email: parsed.client_email,
    // 環境変数経由だと改行が \n の 2 文字になっていることがある
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

/* ------------------------------------------------------------------ */
/* アクセストークン                                                    */
/* ------------------------------------------------------------------ */

type TokenCache = { token: string; expiresAt: number; email: string };
const globalForToken = globalThis as unknown as { __sheetsTokens?: Map<string, TokenCache> };

async function accessToken(scope = SCOPE): Promise<string> {
  const account = loadServiceAccount();
  const tokens = (globalForToken.__sheetsTokens ??= new Map());
  const cached = tokens.get(scope);
  // 期限の 1 分前には取り直す
  if (cached && cached.email === account.client_email && cached.expiresAt - 60_000 > Date.now()) {
    return cached.token;
  }

  let key;
  try {
    key = await importPKCS8(account.private_key, "RS256");
  } catch {
    throw new SheetsError("サービスアカウントの秘密鍵（private_key）を読み込めません。鍵ファイルが壊れていないか確認してください。");
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience(tokenUrl())
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const response = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    const detail = data.error_description ?? data.error ?? `HTTP ${response.status}`;
    throw new SheetsError(
      `Google の認証に失敗しました（${detail}）。` +
        "鍵が削除・無効化されていないか、PC の時刻が大きくずれていないか確認してください。",
      401,
    );
  }
  tokens.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    email: account.client_email,
  });
  return data.access_token;
}

/* ------------------------------------------------------------------ */
/* API 呼び出し                                                        */
/* ------------------------------------------------------------------ */

/** Google のエラーを、何をすれば直るかが分かる日本語にする */
function explain(
  status: number,
  body: { error?: { message?: string; status?: string } },
  target: "app" | "source" = "app",
) {
  const message = body.error?.message ?? "";
  const email = safeEmail();
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(message + body.error?.status)) {
    return new SheetsError(
      "Google Sheets API が有効になっていません。Google Cloud の「API とサービス」→「ライブラリ」で " +
        "Google Sheets API を有効にしてください（有効化の反映に数分かかることがあります）。",
      403,
    );
  }
  if (status === 403) {
    return new SheetsError(
      "スプレッドシートにアクセスする権限がありません。スプレッドシートの「共有」で " +
        `${email ?? "サービスアカウントのメールアドレス"} を` +
        (target === "app" ? "「編集者」として追加してください。" : "「閲覧者」として追加してください。"),
      403,
    );
  }
  if (status === 400 && target === "source" && /Unable to parse range/i.test(message)) {
    return new SheetsError(
      "指定したシートが見つかりません。シート名はタブの名前（例: 請求2026）にしてください。",
      400,
    );
  }
  if (status === 404 && target === "source") {
    return new SheetsError(
      `スプレッドシートまたはシートが見つかりません。ID とシート名を確認してください（${message}）`,
      404,
    );
  }
  if (status === 404) {
    return new SheetsError(
      "スプレッドシートが見つかりません。GOOGLE_SHEETS_ID が正しいか確認してください" +
        "（URL の /d/ と /edit の間の文字列です）。",
      404,
    );
  }
  if (status === 429) {
    return new SheetsError(
      "Google Sheets API の回数制限に達しました。1 分ほど待ってからやり直してください。",
      429,
    );
  }
  return new SheetsError(`Google Sheets API がエラーを返しました（HTTP ${status}）: ${message}`, status);
}

function safeEmail() {
  try {
    return loadServiceAccount().client_email;
  } catch {
    return null;
  }
}

/**
 * Sheets API を呼ぶ。回数制限（429）と一時的な障害（5xx）は少し待って再試行する。
 * 書き込みの batchUpdate も再試行するが、Google は失敗したリクエストを一切適用しないので
 * 二重に書き込まれることはない。
 */
async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; source?: string } = {},
): Promise<T> {
  // source を渡したときは、アプリのデータではなくそのスプレッドシートを読み取り専用で開く
  const token = await accessToken(init.source ? READONLY_SCOPE : SCOPE);
  const id = init.source ?? spreadsheetId();
  const url = `${apiBase()}/v4/spreadsheets/${encodeURIComponent(id)}${path}`;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
    } catch (e) {
      if (attempt < 2) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new SheetsError(
        `Google Sheets API に接続できません: ${e instanceof Error ? e.message : String(e)}`,
        503,
      );
    }

    if (response.ok) return (await response.json()) as T;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    throw explain(
      response.status,
      await response.json().catch(() => ({})),
      init.source ? "source" : "app",
    );
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** シート名を A1 記法の範囲として使える形にする（'明細' のようにクォートする） */
export function quoteSheet(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

export type SheetProperties = {
  sheetId: number;
  title: string;
  gridProperties?: { rowCount?: number; columnCount?: number; frozenRowCount?: number };
};

/** スプレッドシートにあるタブの一覧 */
export async function getSheets(): Promise<SheetProperties[]> {
  const data = await call<{ sheets?: { properties: SheetProperties }[] }>(
    "?fields=sheets.properties(sheetId,title,gridProperties)",
  );
  return (data.sheets ?? []).map((s) => s.properties);
}

/** 複数のタブをまとめて 1 回で読む */
export async function batchGet(ranges: string[]) {
  const params = new URLSearchParams({
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
    majorDimension: "ROWS",
  });
  for (const range of ranges) params.append("ranges", range);
  const data = await call<{ valueRanges?: { range: string; values?: unknown[][] }[] }>(
    `/values:batchGet?${params}`,
  );
  return (data.valueRanges ?? []).map((v) => (v.values ?? []) as (string | number | boolean)[][]);
}

/**
 * まとめて書き込む。Sheets API の batchUpdate は、1 つでも失敗すると何も適用しない。
 * 明細と内訳を 1 回で書けば、明細だけ入って内訳が無い、という中途半端な状態が起きない。
 */
export async function batchUpdate(requests: unknown[]) {
  if (requests.length === 0) return;
  // スプレッドシート本体に対する操作なので、パスは "{id}:batchUpdate"（スラッシュ無し）
  await call(":batchUpdate", { method: "POST", body: { requests } });
}

/**
 * アプリのデータとは別のスプレッドシート（GAS の請求シートなど）の範囲を、
 * 読み取り専用のスコープで 2 次元の文字列として読む。
 *
 * 値は画面に見えているとおりの文字列（FORMATTED_VALUE）で取る。`2026/01/15` `3,200` のまま返るので、
 * CSV 取込と同じ日付・金額の解釈をそのまま通せる。
 * 末尾の空セルは API 側で落とされるので、行ごとに長さが違うことがある。
 */
export async function fetchSheetGrid(sourceId: string, range: string): Promise<string[][]> {
  const id = sourceId.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? sourceId.trim();
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS" });
  const data = await call<{ values?: unknown[][] }>(
    `/values/${encodeURIComponent(range)}?${params}`,
    { source: id },
  );
  return (data.values ?? []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}
