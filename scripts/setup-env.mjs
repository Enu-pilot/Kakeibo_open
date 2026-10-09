/**
 * .env と .env.local を用意する（何度実行しても安全）。
 *   npm run setup:env                                   # 足りない値を補う
 *   npm run setup:env -- --sheet <スプレッドシートの URL>  # スプレッドシートを設定する
 *   npm run setup:env -- --force                        # AUTH_SECRET と APP_PASSWORD を作り直す
 *
 * 動き:
 *  - 無い値・弱い値（雛形のまま、短すぎる）だけを作り直し、まともな値はそのまま残す
 *  - Postgres 時代の値（DATABASE_URL など）は使わないので取り除く
 *  - .env と .env.local を同じ内容にそろえる（食い違いがあれば .env.local を優先）
 *
 * 秘密情報は base64url（A-Z a-z 0-9 - _）で作る。URL やシェルに置いても壊れず、
 * openssl に頼らないので Windows でも動く。
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const FILES = [".env", ".env.local"];
const OBSOLETE = ["DATABASE_URL", "POSTGRES_PASSWORD", "SHADOW_DATABASE_URL"];
const TEMPLATE_VALUES = new Set(["change-me", "replace-with-a-long-random-string", ""]);
const DEFAULT_KEY_FILE = "secrets/google-service-account.json";

const args = process.argv.slice(2);
const force = args.includes("--force");
const sheetArg = (() => {
  const i = args.findIndex((a) => a === "--sheet" || a.startsWith("--sheet="));
  if (i < 0) return null;
  return args[i].includes("=") ? args[i].split("=").slice(1).join("=") : args[i + 1];
})();

/** KEY="value" / KEY=value の行を読む。コメントと空行は捨てる */
function parse(file) {
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return env;
}

function secret(bytes) {
  return randomBytes(bytes).toString("base64url");
}

/** スプレッドシートの URL を貼られても ID だけを取り出す */
function sheetId(input) {
  return input.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? input.trim();
}

const current = { ...parse(".env"), ...parse(".env.local") };
const notes = [];

const env = { ...current };
for (const key of OBSOLETE) {
  if (key in env) {
    delete env[key];
    notes.push(`${key} は使わなくなったので取り除きました。`);
  }
}

if (sheetArg) {
  env.GOOGLE_SHEETS_ID = sheetId(sheetArg);
  notes.push(`GOOGLE_SHEETS_ID を ${env.GOOGLE_SHEETS_ID} にしました。`);
}

// Codespaces のシークレットなどで鍵の中身が渡っていれば、ファイルの設定は要らない
const keyFromSecret = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
if (!keyFromSecret && !env.GOOGLE_SERVICE_ACCOUNT_FILE && !env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  env.GOOGLE_SERVICE_ACCOUNT_FILE = DEFAULT_KEY_FILE;
}

let generatedPassword = null;
if (force || TEMPLATE_VALUES.has(env.AUTH_SECRET ?? "") || (env.AUTH_SECRET ?? "").length < 32) {
  if (env.AUTH_SECRET) notes.push("AUTH_SECRET を作り直しました（ログインし直しが必要です）。");
  env.AUTH_SECRET = secret(32);
}
if (force || TEMPLATE_VALUES.has(env.APP_PASSWORD ?? "") || (env.APP_PASSWORD ?? "").length < 8) {
  generatedPassword = secret(12);
  env.APP_PASSWORD = generatedPassword;
}

const known = ["GOOGLE_SHEETS_ID", "GOOGLE_SERVICE_ACCOUNT_FILE", "GOOGLE_SERVICE_ACCOUNT_JSON", "APP_PASSWORD", "AUTH_SECRET"];
const q = (v) => `"${String(v ?? "").replace(/"/g, '\\"')}"`;

let content = `# npm run setup:env で作成。このファイルはコミットしないこと（.gitignore 済み）。
# Next.js は .env.local を、npm run db:seed などのスクリプトは .env を読むので、同じ内容で 2 つ置いている。

# --- スプレッドシート ---
# URL の /d/ と /edit の間の文字列。npm run setup:env -- --sheet <URL> でも設定できる。
GOOGLE_SHEETS_ID=${q(env.GOOGLE_SHEETS_ID)}
`;
if (env.GOOGLE_SERVICE_ACCOUNT_FILE) {
  content += `# サービスアカウントの鍵ファイル。secrets/ は .gitignore 済み。
# Codespaces のシークレット GOOGLE_SERVICE_ACCOUNT_JSON を使う場合は、この行は消してよい。
GOOGLE_SERVICE_ACCOUNT_FILE=${q(env.GOOGLE_SERVICE_ACCOUNT_FILE)}
`;
}
if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  content += `GOOGLE_SERVICE_ACCOUNT_JSON=${q(env.GOOGLE_SERVICE_ACCOUNT_JSON)}\n`;
}
content += `
# --- ログイン ---
# ログイン画面で入力するパスワード（8 文字以上）。覚えやすいものに変えてよい。
APP_PASSWORD=${q(env.APP_PASSWORD)}
# セッション Cookie の署名鍵（32 文字以上）。推測されると誰でもログインできてしまうので、変えないこと。
AUTH_SECRET=${q(env.AUTH_SECRET)}
`;
const extra = Object.keys(env).filter((k) => !known.includes(k));
if (extra.length > 0) {
  content += "\n# --- 自分で足した設定 ---\n";
  for (const key of extra) content += `${key}=${q(env[key])}\n`;
}

for (const file of FILES) {
  writeFileSync(file, content);
  // writeFileSync の mode は新規作成時にしか効かないので、既存ファイルも所有者だけが読めるようにする
  chmodSync(file, 0o600);
}

console.log(`${FILES.join(" と ")} を用意しました。`);
for (const note of notes) console.log(`  - ${note}`);
if (generatedPassword) {
  console.log("");
  console.log(`  ログインパスワード: ${generatedPassword}`);
  console.log("  （.env と .env.local の APP_PASSWORD を両方書き換えれば、覚えやすいものに変えられます）");
}
console.log("");
if (!env.GOOGLE_SHEETS_ID) {
  console.log("次に: npm run setup:env -- --sheet <スプレッドシートの URL> でスプレッドシートを設定してください。");
} else if (keyFromSecret) {
  console.log("鍵は Codespaces のシークレット GOOGLE_SERVICE_ACCOUNT_JSON から読みます。");
  console.log("次に: npm run sheets:check で接続を確認してください。");
} else if (!existsSync(env.GOOGLE_SERVICE_ACCOUNT_FILE ?? DEFAULT_KEY_FILE)) {
  console.log(`次に: 鍵の JSON を ${env.GOOGLE_SERVICE_ACCOUNT_FILE} に置くか、`);
  console.log("      Codespaces のシークレット GOOGLE_SERVICE_ACCOUNT_JSON に登録してください（こちらを推奨）。");
} else {
  console.log("次に: npm run sheets:check で接続を確認してください。");
}
