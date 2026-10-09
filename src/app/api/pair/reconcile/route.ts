import { handle } from "@/lib/api";
import { withChanges } from "@/lib/db/store";
import { reconcilePair } from "@/lib/pair-household";

/** 取込待ちのカード払いを本体の取込明細と照合し、本体に書けなかった明細を書き直す */
export async function POST() {
  return handle(async () => withChanges((tx, db) => reconcilePair(tx, db)));
}
