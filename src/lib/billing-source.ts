import { z } from "zod";
import { badRequest } from "@/lib/api";
import {
  SheetsError,
  defaultSpreadsheetId,
  fetchSheetGrid,
  isSheetsConfigured,
} from "@/lib/google-sheets";
import { parseBillingGrid, parseBillingSheet } from "@/lib/sheet-blocks";

/** 請求シートの読み先: 貼り付けたテキストか、スプレッドシートの範囲か、どちらか一方 */
export const billingSourceSchema = z.union([
  z.object({
    text: z.string().min(1, "貼り付けたデータが空です").max(4_000_000),
  }),
  z.object({
    sheet: z.object({
      spreadsheetId: z.string().trim().optional(),
      range: z.string().trim().min(1, "シート名か範囲を入力してください"),
    }),
  }),
]);

export type BillingSource = z.infer<typeof billingSourceSchema>;

/** 請求シートを読み、カードごとのブロックに切り分ける（読み取り専用） */
export async function readBillingSource(source: BillingSource) {
  let parsed;
  if ("text" in source) {
    parsed = parseBillingSheet(source.text);
  } else {
    if (!isSheetsConfigured()) {
      throw badRequest(
        "サービスアカウントの鍵が設定されていません。README の「初回セットアップ」を参照してください。",
      );
    }
    const spreadsheetId = source.sheet.spreadsheetId || defaultSpreadsheetId();
    if (!spreadsheetId) throw badRequest("スプレッドシートの ID を入力してください");
    try {
      parsed = parseBillingGrid(await fetchSheetGrid(spreadsheetId, source.sheet.range));
    } catch (error) {
      if (error instanceof SheetsError) throw badRequest(error.message);
      throw error;
    }
  }
  if (parsed.blocks.length === 0) {
    throw badRequest(parsed.warnings[0] ?? "ブロックを検出できませんでした");
  }
  return parsed;
}
