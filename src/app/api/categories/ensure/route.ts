import { z } from "zod";
import { handle, badRequest } from "@/lib/api";
import { newId, now, withChanges } from "@/lib/db/store";
import { byOrderThenName } from "@/lib/db/queries";

const schema = z.object({
  names: z.array(z.string().trim().min(1)).max(2000),
  /** 見つからなかった中項目を作る先の大項目 */
  majorId: z.string().min(1),
});

/**
 * 使用先（イベント名）を中項目として確保する。既にあればその id を返し、無ければ作る。
 *
 * 名前に「投資」が含まれる場合は、指定された大項目ではなく投資の大項目に寄せる。
 * これまで使っていた GAS が同じ判定をしていたため、その扱いを引き継いでいる。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { names, majorId } = schema.parse(await request.json());

    return withChanges((tx, db) => {
      const targetMajor = db.majors.find((m) => m.id === majorId);
      if (!targetMajor) throw badRequest("大項目が見つかりません");

      const investmentMajor = db.majors
        .filter((m) => m.kind === "INVESTMENT" && !m.archivedAt)
        .sort(byOrderThenName)[0];

      const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
      const result: Record<string, string> = {};
      /**
       * 実際に入れた先の大項目の種別。「投資」を含む名前は指定と別の大項目に入るため、
       * 呼び出し側が金額の符号（signFor）を決めるのに使う。
       * これが無いと、投資に入った名前の符号を逆に保存してしまう
       */
      const kinds: Record<string, string> = {};

      for (const name of unique) {
        const major = name.includes("投資") && investmentMajor ? investmentMajor : targetMajor;

        // 同名の中項目が他の大項目にもあり得るので、必ず大項目を絞って探す
        const existing = db.categories.find((c) => c.name === name && c.majorId === major.id);
        kinds[name] = major.kind;
        if (existing) {
          result[name] = existing.id;
          if (existing.archivedAt) {
            tx.update("categories", existing.id, { archivedAt: null, updatedAt: now() });
          }
          continue;
        }
        const timestamp = now();
        const created = tx.insert("categories", {
          id: newId(),
          name,
          majorId: major.id,
          sortOrder: 900,
          archivedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        result[name] = created.id;
      }

      return { categories: result, kinds };
    });
  });
}
