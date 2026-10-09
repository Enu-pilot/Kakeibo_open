import { z } from "zod";
import { handle } from "@/lib/api";
import { loadSnapshot, newId, now, withChanges } from "@/lib/db/store";

export async function GET() {
  return handle(async () => {
    const db = await loadSnapshot();
    return [...db.presets].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  });
}

const schema = z.object({
  name: z.string().trim().min(1, "プリセット名を入力してください"),
  encoding: z.enum(["auto", "UTF8", "SJIS"]).default("auto"),
  skipRows: z.number().int().min(0).max(50).default(0),
  mapping: z.record(z.string(), z.unknown()),
  defaultPaymentMethodId: z.string().nullable().optional(),
});

/** 同名なら上書き保存する（カード会社ごとに 1 つ持つ想定） */
export async function POST(request: Request) {
  return handle(async () => {
    const input = schema.parse(await request.json());
    const data = {
      encoding: input.encoding,
      skipRows: input.skipRows,
      mapping: input.mapping,
      defaultPaymentMethodId: input.defaultPaymentMethodId ?? null,
      updatedAt: now(),
    };
    return withChanges((tx, db) => {
      const existing = db.presets.find((p) => p.name === input.name);
      if (existing) return tx.update("presets", existing.id, data);
      return tx.insert("presets", { id: newId(), name: input.name, createdAt: now(), ...data });
    });
  });
}
