import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthConfigError,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  passwordMatches,
} from "@/lib/auth";
import { lockedSeconds, recordFailure, recordSuccess } from "@/lib/login-throttle";

const schema = z.object({ password: z.string().min(1) });

/** 失敗のたびに少し待たせ、総当たりの速度を落とす */
const FAILURE_DELAY_MS = 500;

export async function POST(request: Request) {
  const wait = lockedSeconds();
  if (wait > 0) {
    return NextResponse.json(
      { error: `ログインの失敗が続いたため受け付けを止めています。${wait} 秒後にやり直してください。` },
      { status: 429, headers: { "retry-after": String(wait) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "パスワードを入力してください" }, { status: 400 });
  }

  try {
    if (!passwordMatches(parsed.data.password)) {
      recordFailure();
      await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
      return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
    }

    const token = await createSessionToken();
    recordSuccess();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  } catch (error) {
    // 設定の不備はログイン画面にそのまま出す（何を直せばよいか分かるように）
    if (error instanceof AuthConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }
}
