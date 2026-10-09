/**
 * スプレッドシートの初期化と初期データの投入（npm run db:seed）。
 *
 * 何度実行しても安全:
 *  - 無いタブだけを作り、見出しを書く
 *  - タブはあるが見出しが欠けている場合は、欠けた見出しを右端に足す（既存の列は動かさない）
 *  - 初期データは「無いものだけ」足す。名前を変えた・自分で足したデータには触らない
 */
import { SCHEMA, TABLE_ORDER } from "@/lib/db/schema";
import { batchGet, batchUpdate, getSheets, quoteSheet } from "@/lib/db/sheets-client";
import { newId, now, withChanges } from "@/lib/db/store";
import { COST_TYPES, MAJORS, PAYMENT_METHODS, PURPOSES, RULES } from "@/lib/db/seed-data";

/** 新しいスプレッドシートに最初からある空のタブ */
const DEFAULT_SHEET_TITLES = new Set(["シート1", "Sheet1"]);

export type EnsureResult = { createdTabs: string[]; addedHeaders: string[]; removedDefault: boolean };

export async function ensureSheets(): Promise<EnsureResult> {
  const before = await getSheets();
  const existingTitles = new Set(before.map((s) => s.title));
  const missing = TABLE_ORDER.filter((t) => !existingTitles.has(SCHEMA[t].title));

  if (missing.length > 0) {
    await batchUpdate(
      missing.map((table) => ({
        addSheet: {
          properties: {
            title: SCHEMA[table].title,
            index: TABLE_ORDER.indexOf(table),
            // 見出し行を固定し、下にスクロールしても列名が見えるようにする
            gridProperties: { frozenRowCount: 1 },
          },
        },
      })),
    );
  }

  const sheets = await getSheets();
  const byTitle = new Map(sheets.map((s) => [s.title, s]));
  const headerRows = await batchGet(TABLE_ORDER.map((t) => `${quoteSheet(SCHEMA[t].title)}!1:1`));

  const requests: unknown[] = [];
  const addedHeaders: string[] = [];
  TABLE_ORDER.forEach((table, i) => {
    const def = SCHEMA[table];
    const props = byTitle.get(def.title)!;
    const header = (headerRows[i]?.[0] ?? []).map((h) => String(h ?? "").trim());
    const lacking = def.columns.filter((c) => !header.includes(c.header));
    if (lacking.length === 0) return;

    const startColumn = header.length;
    const neededColumns = startColumn + lacking.length;
    const columnCount = props.gridProperties?.columnCount ?? 26;
    if (neededColumns > columnCount) {
      requests.push({
        appendDimension: {
          sheetId: props.sheetId,
          dimension: "COLUMNS",
          length: neededColumns - columnCount,
        },
      });
    }
    requests.push({
      updateCells: {
        range: {
          sheetId: props.sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: startColumn,
          endColumnIndex: neededColumns,
        },
        rows: [
          {
            values: lacking.map((c) => ({
              userEnteredValue: { stringValue: c.header },
              userEnteredFormat: { textFormat: { bold: true } },
            })),
          },
        ],
        fields: "userEnteredValue,userEnteredFormat.textFormat.bold",
      },
    });
    // 作ったばかりのタブの見出しは「欠けていた」わけではないので、既存タブの補修だけを報告する
    if (!missing.includes(table)) {
      addedHeaders.push(...lacking.map((c) => `${def.title}!${c.header}`));
    }
  });

  // 新規作成時に最初からある空の「シート1」は、紛らわしいので消す（中身があれば残す）
  let removedDefault = false;
  if (missing.length > 0) {
    const defaults = sheets.filter((s) => DEFAULT_SHEET_TITLES.has(s.title));
    if (defaults.length > 0) {
      const contents = await batchGet(defaults.map((s) => quoteSheet(s.title)));
      defaults.forEach((sheet, i) => {
        const empty = (contents[i] ?? []).every((row) =>
          row.every((cell) => cell === "" || cell === null || cell === undefined),
        );
        if (empty) {
          requests.push({ deleteSheet: { sheetId: sheet.sheetId } });
          removedDefault = true;
        }
      });
    }
  }

  await batchUpdate(requests);
  return { createdTabs: missing.map((t) => SCHEMA[t].title), addedHeaders, removedDefault };
}

/** 初期データのうち、まだ無いものだけを足す */
export async function seed() {
  return withChanges((tx, db) => {
    const timestamp = now();
    const added = { purposes: 0, majors: 0, categories: 0, costTypes: 0, paymentMethods: 0, rules: 0 };

    for (const [index, name] of PURPOSES.entries()) {
      if (db.purposes.some((p) => p.name === name)) continue;
      tx.insert("purposes", {
        id: newId(),
        name,
        sortOrder: index * 10,
        openingBalance: 0,
        openingBalanceAt: null,
        archivedAt: null,
        createdAt: timestamp,
      });
      added.purposes++;
    }
    const purposeIdOf = (name: string | undefined) =>
      name ? (db.purposes.find((p) => p.name === name)?.id ?? null) : null;

    for (const [majorIndex, spec] of MAJORS.entries()) {
      const sortOrder = majorIndex * 10;
      let major = db.majors.find((m) => m.name === spec.name);
      if (major) {
        // 集計種別と並び順は「まとめ」の構造そのものなので、再実行で標準に戻す。
        // 色や中項目の追加といったユーザーの調整はそのまま残る。
        if (major.kind !== spec.kind || major.sortOrder !== sortOrder) {
          tx.update("majors", major.id, { kind: spec.kind, sortOrder, updatedAt: timestamp });
        }
        // 使途は、まだ決めていない大項目にだけ付ける（自分で付け替えたものは変えない）
        const purposeId = purposeIdOf(spec.purpose);
        if (!major.purposeId && purposeId) {
          tx.update("majors", major.id, { purposeId, updatedAt: timestamp });
        }
      } else {
        major = tx.insert("majors", {
          id: newId(),
          name: spec.name,
          kind: spec.kind,
          color: spec.color,
          sortOrder,
          isSystem: true,
          purposeId: purposeIdOf(spec.purpose),
          archivedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        added.majors++;
      }
      for (const [index, name] of spec.categories.entries()) {
        if (db.categories.some((c) => c.majorId === major.id && c.name === name)) continue;
        tx.insert("categories", {
          id: newId(),
          name,
          majorId: major.id,
          sortOrder: index * 10,
          archivedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        added.categories++;
      }
    }

    for (const [index, name] of COST_TYPES.entries()) {
      if (db.costTypes.some((c) => c.name === name)) continue;
      tx.insert("costTypes", { id: newId(), name, sortOrder: index * 10, archivedAt: null, createdAt: timestamp });
      added.costTypes++;
    }

    for (const [index, spec] of PAYMENT_METHODS.entries()) {
      if (db.paymentMethods.some((m) => m.name === spec.name)) continue;
      tx.insert("paymentMethods", {
        id: newId(),
        name: spec.name,
        kind: spec.kind,
        sortOrder: index * 10,
        // 口座・現金・電子マネーは残高そのものなので追う。カードは利用額なので追わない
        trackBalance: spec.kind !== "CARD",
        openingBalance: 0,
        openingBalanceAt: null,
        archivedAt: null,
        createdAt: timestamp,
      });
      added.paymentMethods++;
    }

    for (const spec of RULES) {
      const major = spec.major ? db.majors.find((m) => m.name === spec.major) : undefined;
      const category = major && spec.category
        ? db.categories.find((c) => c.majorId === major.id && c.name === spec.category)
        : undefined;
      const costType = spec.costType ? db.costTypes.find((c) => c.name === spec.costType) : undefined;
      if (!category && !costType) continue;
      if (db.rules.some((r) => r.keyword === spec.keyword && r.matchType === spec.matchType)) continue;
      tx.insert("rules", {
        id: newId(),
        keyword: spec.keyword,
        matchType: spec.matchType,
        categoryId: category?.id ?? null,
        costTypeId: costType?.id ?? null,
        priority: spec.priority,
        isLearned: false,
        enabled: true,
        hitCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      added.rules++;
    }

    return {
      added,
      totals: {
        使途: db.purposes.length,
        大項目: db.majors.length,
        中項目: db.categories.length,
        費目: db.costTypes.length,
        決済手段: db.paymentMethods.length,
        ルール: db.rules.length,
      },
    };
  });
}
