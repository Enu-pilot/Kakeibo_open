import { handle } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { autoLinkHistory } from "@/lib/pair-match";

/** 過去分の取込のうち、家計簿に候補が 1 件だけの明細をまとめて結び付ける（本体は書き換えない） */
export async function POST() {
  return handle(async () => withChanges((tx, db) => autoLinkHistory(tx, db)));
}
