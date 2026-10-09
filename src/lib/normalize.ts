/**
 * 利用先の表記ゆれを吸収する。
 * 全角/半角、空白、大文字小文字の違いで別物と判定しないようにする。
 * （サーバー・クライアント双方から使うため node:crypto に依存しない形で分離）
 */
export function normalizeDescription(text: string) {
  return text
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .toLowerCase();
}
