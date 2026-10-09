"use client";

/** fetch のラッパー。API のエラーメッセージをそのまま例外にする。 */
export async function api<T>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `通信に失敗しました (${response.status})`);
  }
  return data as T;
}
