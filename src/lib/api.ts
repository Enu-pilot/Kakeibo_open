import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { SheetsError } from "@/lib/db/sheets-client";

/** API ハンドラの共通エラー処理。想定外の例外も JSON で返す。 */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "入力内容が正しくありません", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    // スプレッドシートの権限・共有・API 有効化の問題は、直し方つきのメッセージをそのまま返す
    if (error instanceof SheetsError) {
      console.error(error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(error);
    const message =
      error instanceof Error ? error.message : "サーバーエラーが発生しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string) {
  return new HttpError(400, message);
}

export function notFound(message = "見つかりません") {
  return new HttpError(404, message);
}
