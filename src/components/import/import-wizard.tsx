"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Upload, Save, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { PreviewTable } from "@/components/import/preview-table";
import {
  decodeCsv,
  guessMapping,
  mapRow,
  parseCsv,
  type ColumnMapping,
  type CsvEncoding,
  type MappedRow,
} from "@/lib/csv";
import { api } from "@/lib/client-api";
import { signFor } from "@/lib/category-kind";
import {
  INCOME_FALLBACK_MAJOR,
  inflowCountsAsIncome,
  type PaymentKind,
} from "@/lib/inflow";
import {
  buildCategoryIndex,
  pickByDirection,
  resolveIncomeTarget,
  resolveNettingTarget,
} from "@/lib/import-routing";
import { normalizeDescription } from "@/lib/normalize";
import type { CategoryKind } from "@/lib/db/types";
import type {
  CostTypeView,
  MajorWithCategories,
  PaymentMethodView,
} from "@/lib/view-types";

export type PresetView = {
  id: string;
  name: string;
  encoding: CsvEncoding;
  skipRows: number;
  mapping: Record<string, unknown>;
  defaultPaymentMethodId: string | null;
};

export type BatchView = {
  id: string;
  fileName: string;
  importedCount: number;
  skippedCount: number;
  createdAt: string;
};

const EMPTY_MAPPING: ColumnMapping = {
  date: "",
  description: "",
  amount: "",
  amountSign: "positive-expense",
};

export function ImportWizard({
  majors,
  paymentMethods,
  costTypes,
  presets,
  recentBatches,
}: {
  majors: MajorWithCategories[];
  paymentMethods: PaymentMethodView[];
  costTypes: CostTypeView[];
  presets: PresetView[];
  recentBatches: BatchView[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [encoding, setEncoding] = useState<CsvEncoding>("auto");
  const [skipRows, setSkipRows] = useState(0);
  // 選んだ（またはプリセットから読み込んだ）列の対応づけ。
  // まだ何も選んでいない間は、ヘッダー名からの推測を使う。
  const [chosenMapping, setChosenMapping] = useState<ColumnMapping | null>(null);
  const [defaultPaymentMethodId, setDefaultPaymentMethodId] = useState("");
  const [fallbackCategoryId, setFallbackCategoryId] = useState("");
  /** 使用先列を中項目として使うときに、新しい中項目を作る先の大項目 */
  const [usageMajorId, setUsageMajorId] = useState("");
  /** 生活費ぶんの内訳を作る先の大項目（既定は生活費） */
  const [livingMajorId, setLivingMajorId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [categoryByRow, setCategoryByRow] = useState<Record<number, string>>({});
  const [costTypeByRow, setCostTypeByRow] = useState<Record<number, string | null>>({});
  /** 入金の扱いを手で切り替えた行（切り替えていない行は決済手段の種類で決まる） */
  const [incomeOverride, setIncomeOverride] = useState<Record<number, boolean>>({});
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // ファイル + 文字コード + 読み飛ばし行数からテーブルを作る
  const table = useMemo(() => {
    if (!buffer) return null;
    try {
      return parseCsv(decodeCsv(buffer, encoding), skipRows);
    } catch {
      return null;
    }
  }, [buffer, encoding, skipRows]);

  /**
   * 使う列の対応づけ。
   * 選択済みの日付列が今のヘッダーに残っていればその選択を活かし、
   * 残っていなければ（＝読み飛ばし行数や文字コードを変えてヘッダーが入れ替わった）
   * ヘッダー名から推測し直す。
   */
  const mapping: ColumnMapping = useMemo(() => {
    const headers = table?.headers ?? [];
    if (chosenMapping && (headers.length === 0 || headers.includes(chosenMapping.date))) {
      return chosenMapping;
    }
    return { ...EMPTY_MAPPING, ...guessMapping(headers) } as ColumnMapping;
  }, [chosenMapping, table]);

  const setMapping = setChosenMapping;

  /**
   * 取込の途中で新しく作った中項目の種別。画面が持っている大項目の一覧には
   * まだ入っていないので、作ったときに API が返す種別を覚えておく。
   */
  const createdKinds = useRef(new Map<string, CategoryKind>());
  /** 取込の途中で作った受け皿の大項目（収入内訳）の id */
  const createdFallbackMajor = useRef<string | null>(null);

  function rememberKinds(
    categories: Record<string, string>,
    kinds: Record<string, CategoryKind>,
  ) {
    for (const [name, id] of Object.entries(categories)) {
      if (kinds[name]) createdKinds.current.set(id, kinds[name]);
    }
  }

  /** 中項目 → 種別。内訳の符号（払い戻しはマイナス）を決めるのに使う。 */
  const kindByCategory = useMemo(() => {
    const map = new Map<string, CategoryKind>();
    for (const major of majors) {
      for (const category of major.categories) map.set(category.id, major.kind);
    }
    return map;
  }, [majors]);

  const mappedRows: MappedRow[] = useMemo(() => {
    if (!table || !mapping.date || !mapping.description || !mapping.amount) return [];
    return table.rows.map((row, index) => mapRow(row, mapping, index));
  }, [table, mapping]);

  const validRows = mappedRows.filter((row) => !row.error);

  const categoryIndex = useMemo(() => buildCategoryIndex(majors), [majors]);

  /** 行の決済手段の種類。決済手段が分からない行はカード扱い（入金は差し引き）にする */
  function paymentKindOf(row: MappedRow): PaymentKind {
    const id = resolvePaymentMethodId(row);
    const kind = paymentMethods.find((method) => method.id === id)?.kind;
    return (kind as PaymentKind | undefined) ?? "CARD";
  }

  /**
   * 入金の行を収入として数えるか。手で切り替えていればそれを、
   * していなければ決済手段の種類で決める（銀行・現金は収入、カードは差し引き など）。
   */
  const incomeByRow = useMemo(() => {
    const result: Record<number, boolean> = {};
    for (const row of validRows) {
      if (!row.isIncome) continue;
      result[row.rowIndex] =
        incomeOverride[row.rowIndex] ??
        inflowCountsAsIncome(paymentKindOf(row), row.description);
    }
    return result;
    // paymentKindOf は描画ごとに作り直される関数なので、依存する値そのものを並べる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validRows, incomeOverride, paymentMethods, defaultPaymentMethodId]);

  async function onFile(file: File) {
    setError(null);
    setMessage(null);
    setCategoryByRow({});
    setFileName(file.name);
    setBuffer(await file.arrayBuffer());
  }

  /**
   * 各行に中項目を割り当てる。
   * 使用先列があればその値をそのまま中項目にし、無ければ利用先をルールに当てる。
   */
  async function classify(rows: MappedRow[]) {
    const descriptions = [...new Set(rows.map((row) => row.description))];
    const { matches, costTypes: ruledCostTypes } = await api<{
      matches: Record<string, string | null>;
      costTypes: Record<string, string | null>;
    }>("/api/import/classify", { method: "POST", body: { descriptions } });

    // 費目: 費目列があればその値（名前）を、無ければ店名からのルールを使う
    const costTypeByName = new Map(costTypes.map((c) => [normalizeDescription(c.name), c.id]));
    const nextCostTypes: Record<number, string | null> = {};
    for (const row of rows) {
      nextCostTypes[row.rowIndex] =
        (row.costTypeName ? costTypeByName.get(normalizeDescription(row.costTypeName)) : undefined) ??
        ruledCostTypes[row.description] ??
        null;
    }
    setCostTypeByRow(nextCostTypes);

    if (mapping.usage) {
      // 使用先と同じ名前の中項目が既にあれば（どの大項目でも）それを使う。
      // 同名が支出側と収入側の両方にあるときは、お金の向きで選ぶ。
      // どこにも無い名前だけを、選んだ大項目の下に作る。
      const next: Record<number, string> = {};
      const unknown = new Set<string>();
      /** 収入として数える入金の行にしか出てこない新しい名前（収入側に作るので、選んだ大項目には作らない） */
      const incomeOnly = new Map<string, MappedRow[]>();
      const usedByOther = new Set<string>();
      for (const row of rows) {
        if (!row.usage) continue;
        const candidates = categoryIndex.byName.get(normalizeDescription(row.usage));
        const toIncome = Boolean(incomeByRow[row.rowIndex]);
        const picked = pickByDirection(candidates, toIncome) ?? candidates?.[0];
        if (picked) next[row.rowIndex] = picked.id;
        else if (toIncome) incomeOnly.set(row.usage, [...(incomeOnly.get(row.usage) ?? []), row]);
        else {
          unknown.add(row.usage);
          usedByOther.add(row.usage);
        }
      }
      // 出金にも出てくる名前は選んだ大項目に作り、入金の行も同じ中項目に割り当てる（保存時に収入側へ回す）
      for (const name of usedByOther) incomeOnly.delete(name);
      // 入金だけの新しい名前は、いま収入側（同じ名前の大項目、無ければ「収入内訳」）に作って割り当てる
      Object.assign(next, await routeIncome([...incomeOnly.values()].flat(), {}));
      // 使用先が大項目の名前と同じ（使用先「給料」→ 大項目「給料」）なら、その大項目の下に同名で作る。
      // それ以外の新しい名前は、選んだ大項目の下に作る。
      const byMajor = new Map<string, string[]>();
      for (const name of unknown) {
        const majorId =
          categoryIndex.majorsByName.get(normalizeDescription(name))?.id ?? usageMajorId;
        if (!majorId) {
          throw new Error(
            `中項目に無い使用先があります（${name} など）。作る先の大項目を選んでください。`,
          );
        }
        byMajor.set(majorId, [...(byMajor.get(majorId) ?? []), name]);
      }
      for (const [majorId, names] of byMajor) {
        const { categories, kinds } = await api<{
          categories: Record<string, string>;
          kinds: Record<string, CategoryKind>;
        }>(
          "/api/categories/ensure",
          { method: "POST", body: { names, majorId } },
        );
        rememberKinds(categories, kinds);
        for (const row of rows) {
          if (row.usage && !next[row.rowIndex] && categories[row.usage]) {
            next[row.rowIndex] = categories[row.usage];
          }
        }
      }
      // 使用先が空の行（カードの引き落としなど）は、既定カテゴリが空なら取り込まない
      for (const row of rows) {
        if (!next[row.rowIndex] && fallbackCategoryId) next[row.rowIndex] = fallbackCategoryId;
      }
      setCategoryByRow(next);
      setMessage(
        `${rows.length} 行に使用先から中項目を割り当てました（新しく作った中項目 ${unknown.size + incomeOnly.size} 件）。`,
      );
      // 作った中項目を選択肢に出すため、画面のカテゴリ一覧を読み直す（入力中の内容は残る）
      if (unknown.size + incomeOnly.size > 0) router.refresh();
      return;
    }

    const next: Record<number, string> = {};
    for (const row of rows) {
      next[row.rowIndex] = matches[row.description] ?? fallbackCategoryId;
    }
    setCategoryByRow(next);
    const matched = rows.filter((row) => matches[row.description]).length;
    setMessage(
      `${rows.length} 行のうち ${matched} 行をルールで自動分類しました。残りは未分類の扱いです。`,
    );
  }

  async function runClassify() {
    setPending(true);
    setError(null);
    try {
      await classify(validRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "自動分類に失敗しました");
    } finally {
      setPending(false);
    }
  }

  async function savePreset() {
    setError(null);
    try {
      await api("/api/import/presets", {
        method: "POST",
        body: {
          name: presetName.trim(),
          encoding,
          skipRows,
          mapping,
          defaultPaymentMethodId: defaultPaymentMethodId || null,
        },
      });
      setMessage(`プリセット「${presetName}」を保存しました`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "プリセットの保存に失敗しました");
    }
  }

  function applyPreset(id: string) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setEncoding(preset.encoding);
    setSkipRows(preset.skipRows);
    setChosenMapping({
      ...EMPTY_MAPPING,
      ...(preset.mapping as Partial<ColumnMapping>),
    });
    setDefaultPaymentMethodId(preset.defaultPaymentMethodId ?? "");
    setPresetName(preset.name);
  }

  async function commit() {
    setPending(true);
    setError(null);
    try {
      // 生活費ぶんの内訳は、同じ使用先の中項目を生活費側の大項目にも作って割り当てる
      let livingCategories: Record<string, string> = {};
      const needsLiving = validRows.some((row) => (row.livingAmount ?? 0) !== 0);
      if (needsLiving) {
        if (!livingMajorId) {
          throw new Error("生活費ぶんを入れる大項目を選んでください。");
        }
        const names = [
          ...new Set(validRows.filter((r) => r.livingAmount).map((r) => r.usage)),
        ].filter(Boolean) as string[];
        if (names.length > 0) {
          const { categories, kinds } = await api<{
            categories: Record<string, string>;
            kinds: Record<string, CategoryKind>;
          }>(
            "/api/categories/ensure",
            { method: "POST", body: { names, majorId: livingMajorId } },
          );
          rememberKinds(categories, kinds);
          livingCategories = categories;
        }
      }

      const incomeCategories = await routeIncome(
        validRows.filter((row) => incomeByRow[row.rowIndex] && categoryByRow[row.rowIndex]),
        categoryByRow,
      );

      const rows = validRows
        .filter((row) => categoryByRow[row.rowIndex])
        .map((row) => ({
          date: row.date as string,
          description: row.description,
          memo: row.memo,
          splits: buildSplits(
            row,
            livingCategories,
            incomeCategories[row.rowIndex],
            nettingCategoryOf(row),
          ),
          paymentMethodId: resolvePaymentMethodId(row),
        }))
        .filter((row) => row.splits.length > 0);

      if (rows.length === 0) {
        throw new Error("取り込む行がありません。カテゴリを割り当ててください。");
      }

      const result = await api<{ imported: number; skipped: number }>(
        "/api/import/commit",
        {
          method: "POST",
          body: {
            fileName: fileName ?? "import.csv",
            presetName: presetName || null,
            rows,
            allowDuplicate,
          },
        },
      );
      setMessage(
        `${result.imported} 件を取り込みました。` +
          (result.skipped > 0
            ? `${result.skipped} 件は既に同じ明細があるためスキップしました。`
            : ""),
      );
      setBuffer(null);
      setFileName(null);
      setCategoryByRow({});
      setCostTypeByRow({});
      setIncomeOverride({});
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り込みに失敗しました");
    } finally {
      setPending(false);
    }
  }

  /** 入金を差し引きとして扱う行の行き先。収入側が割り当たっていたら支出側の同名に付け替える */
  function nettingCategoryOf(row: MappedRow) {
    if (!row.isIncome || incomeByRow[row.rowIndex]) return undefined;
    const assigned = categoryByRow[row.rowIndex];
    const name = row.usage ?? categoryIndex.byId.get(assigned)?.name;
    return name ? resolveNettingTarget(name, assigned, categoryIndex) : undefined;
  }

  /** 入金の扱いを切り替えたら、表示している中項目も向きに合わせて選び直す */
  function toggleIncome(row: MappedRow) {
    const nextIncome = !incomeByRow[row.rowIndex];
    setIncomeOverride((prev) => ({ ...prev, [row.rowIndex]: nextIncome }));
    const assigned = categoryByRow[row.rowIndex];
    const name = row.usage ?? categoryIndex.byId.get(assigned)?.name;
    if (!name) return;
    const picked = nextIncome
      ? pickByDirection(categoryIndex.byName.get(normalizeDescription(name)), true)
      : categoryIndex.byId.get(resolveNettingTarget(name, assigned, categoryIndex) ?? "");
    if (picked) setCategoryByRow((prev) => ({ ...prev, [row.rowIndex]: picked.id }));
  }

  /**
   * 収入として数える入金の行き先（中項目）を決める。
   * 同じ名前の収入側の中項目があればそこへ、使用先が大項目名ならその大項目の同名の中項目へ、
   * どれも無ければ受け皿の「収入内訳」に同じ名前で作って入れる。
   */
  async function routeIncome(rows: MappedRow[], assignedByRow: Record<number, string | undefined>) {
    const result: Record<number, string> = {};
    const toEnsure = new Map<string, Set<string>>(); // majorId → 名前
    const fallbackNames = new Set<string>();
    const pending: { rowIndex: number; majorId: string | null; name: string }[] = [];

    for (const row of rows) {
      const assignedId = assignedByRow[row.rowIndex];
      const assigned = assignedId ? categoryIndex.byId.get(assignedId) : undefined;
      const name = row.usage ?? assigned?.name ?? row.description;
      const target = resolveIncomeTarget(name, assignedId, categoryIndex);
      if (target.type === "existing") {
        result[row.rowIndex] = target.categoryId;
      } else if (target.type === "ensure") {
        if (!toEnsure.has(target.majorId)) toEnsure.set(target.majorId, new Set());
        toEnsure.get(target.majorId)!.add(target.name);
        pending.push({ rowIndex: row.rowIndex, majorId: target.majorId, name: target.name });
      } else {
        fallbackNames.add(target.name);
        pending.push({ rowIndex: row.rowIndex, majorId: null, name: target.name });
      }
    }

    if (fallbackNames.size > 0) {
      let fallbackMajorId =
        majors.find((major) => major.name === INCOME_FALLBACK_MAJOR && major.kind === "INCOME")?.id ??
        createdFallbackMajor.current;
      if (!fallbackMajorId) {
        const created = await api<{ id: string }>("/api/majors", {
          method: "POST",
          body: { name: INCOME_FALLBACK_MAJOR, kind: "INCOME" },
        });
        fallbackMajorId = created.id;
        // 画面の大項目一覧は読み直すまで古いので、同じ取込の中で二度作らないよう覚えておく
        createdFallbackMajor.current = created.id;
      }
      if (!toEnsure.has(fallbackMajorId)) toEnsure.set(fallbackMajorId, new Set());
      for (const name of fallbackNames) toEnsure.get(fallbackMajorId)!.add(name);
      for (const item of pending) if (item.majorId === null) item.majorId = fallbackMajorId;
    }

    const ensured = new Map<string, Record<string, string>>();
    for (const [majorId, names] of toEnsure) {
      const { categories, kinds } = await api<{
        categories: Record<string, string>;
        kinds: Record<string, CategoryKind>;
      }>("/api/categories/ensure", { method: "POST", body: { names: [...names], majorId } });
      rememberKinds(categories, kinds);
      ensured.set(majorId, categories);
    }
    for (const item of pending) {
      const id = ensured.get(item.majorId!)?.[item.name];
      if (id) result[item.rowIndex] = id;
    }
    return result;
  }

  /**
   * 1 行を内訳に変換する。
   * 個人支出列・生活費列があればその 2 つに分け、無ければ全額を 1 件の内訳にする。
   * 金額の符号は割り当てた中項目の種別で決まる（signFor）。支出の中項目に付いた
   * 払い戻しはマイナスになり、その中項目から差し引かれる。
   * 収入として数える入金は、incomeCategoryId の中項目に全額を入れる。
   */
  function buildSplits(
    row: MappedRow,
    livingCategories: Record<string, string>,
    incomeCategoryId?: string,
    nettingCategoryId?: string,
  ) {
    const splits: { categoryId: string; amount: number; costTypeId: string | null }[] = [];
    const mainCategoryId = nettingCategoryId ?? categoryByRow[row.rowIndex];
    const costTypeId = costTypeByRow[row.rowIndex] ?? null;

    /** 既にある中項目は一覧から、取込の途中で作った中項目は作ったときの種別から引く */
    const kindOf = (categoryId: string): CategoryKind =>
      kindByCategory.get(categoryId) ?? createdKinds.current.get(categoryId) ?? "EXPENSE";

    /** 支出をプラスとする金額を、その中項目の向きに直す */
    const toSplit = (categoryId: string, expenseSigned: number) => ({
      categoryId,
      amount:
        signFor(kindOf(categoryId), expenseSigned < 0) *
        Math.abs(expenseSigned),
      costTypeId,
    });

    if (incomeCategoryId && row.amount) {
      splits.push(toSplit(incomeCategoryId, -row.amount));
      return splits;
    }

    const hasSplitColumns = row.personalAmount !== null || row.livingAmount !== null;
    if (!hasSplitColumns) {
      if (mainCategoryId && row.amount) {
        splits.push(
          toSplit(mainCategoryId, row.isIncome ? -row.amount : row.amount),
        );
      }
      return splits;
    }

    if (row.personalAmount && mainCategoryId) {
      splits.push(toSplit(mainCategoryId, row.personalAmount));
    }
    if (row.livingAmount) {
      const livingCategoryId = row.usage ? livingCategories[row.usage] : undefined;
      if (livingCategoryId) {
        splits.push(toSplit(livingCategoryId, row.livingAmount));
      } else if (mainCategoryId) {
        // 使用先が無い明細は分けようがないので、全額を主たる内訳に寄せる
        splits.push(toSplit(mainCategoryId, row.livingAmount));
      }
    }
    return splits;
  }

  function resolvePaymentMethodId(row: MappedRow) {
    if (row.paymentMethodName) {
      const match = paymentMethods.find(
        (method) => method.name === row.paymentMethodName,
      );
      if (match) return match.id;
    }
    return defaultPaymentMethodId || null;
  }

  async function undoBatch(batch: BatchView) {
    if (
      !confirm(
        `「${batch.fileName}」で取り込んだ ${batch.importedCount} 件を削除します。よろしいですか？`,
      )
    )
      return;
    try {
      await api(`/api/import/batches/${batch.id}`, { method: "DELETE" });
      setMessage("取り込みを取り消しました");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました");
    }
  }

  const assignedCount = validRows.filter((row) => categoryByRow[row.rowIndex]).length;

  return (
    <div className="space-y-4">
      <h1 className="text-std-28B-150 text-solid-gray-900">CSV 取込</h1>

      <Card>
        <CardHeader>
          <CardTitle>1. ファイルを選ぶ</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-muted">
                CSV ファイル
              </label>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFile(file);
                }}
                className="text-sm file:mr-2 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
              />
            </div>
            <Field label="文字コード" className="w-32">
              <Select
                value={encoding}
                onChange={(e) => {
                  setEncoding(e.target.value as CsvEncoding);
                  setCategoryByRow({});
                }}
              >
                <option value="auto">自動判定</option>
                <option value="SJIS">Shift_JIS</option>
                <option value="UTF8">UTF-8</option>
              </Select>
            </Field>
            <Field label="先頭の読み飛ばし行数" className="w-40">
              <Input
                type="number"
                min={0}
                max={50}
                className="tabular"
                value={skipRows}
                onChange={(e) => {
                  // 行番号がずれるので、割り当て済みのカテゴリは一度捨てる
                  setSkipRows(Math.max(0, Number(e.target.value)));
                  setCategoryByRow({});
                }}
              />
            </Field>
            {presets.length > 0 ? (
              <Field label="プリセットを読み込む" className="w-48">
                <Select defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
                  <option value="">選択してください</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {table ? (
            <p className="text-xs text-fg-muted">
              {table.headers.length} 列 / {table.rows.length} 行を読み込みました。
              文字化けする場合は文字コードを切り替えてください。
            </p>
          ) : null}
        </CardBody>
      </Card>

      {table ? (
        <Card>
          <CardHeader>
            <CardTitle>2. 列を対応づける</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ColumnField
                label="日付 *"
                headers={table.headers}
                value={mapping.date}
                onChange={(date) => setMapping({ ...mapping, date })}
              />
              <ColumnField
                label="利用先 / 内容 *"
                headers={table.headers}
                value={mapping.description}
                onChange={(description) => setMapping({ ...mapping, description })}
              />
              <ColumnField
                label="金額 *"
                headers={table.headers}
                value={mapping.amount}
                onChange={(amount) => setMapping({ ...mapping, amount })}
              />
              <Field label="金額の符号">
                <Select
                  value={mapping.amountSign}
                  onChange={(e) =>
                    setMapping({
                      ...mapping,
                      amountSign: e.target.value as ColumnMapping["amountSign"],
                    })
                  }
                >
                  <option value="positive-expense">正の数が支出（カード明細）</option>
                  <option value="negative-expense">負の数が支出（銀行明細）</option>
                </Select>
              </Field>
              <ColumnField
                label="入金列（任意）"
                headers={table.headers}
                value={mapping.amountIn ?? ""}
                onChange={(amountIn) =>
                  setMapping({ ...mapping, amountIn: amountIn || undefined })
                }
                allowEmpty
              />
              <ColumnField
                label="メモ列（任意）"
                headers={table.headers}
                value={mapping.memo ?? ""}
                onChange={(memo) => setMapping({ ...mapping, memo: memo || undefined })}
                allowEmpty
              />
              <ColumnField
                label="決済手段列（任意）"
                headers={table.headers}
                value={mapping.paymentMethod ?? ""}
                onChange={(paymentMethod) =>
                  setMapping({ ...mapping, paymentMethod: paymentMethod || undefined })
                }
                allowEmpty
              />
              <ColumnField
                label="使用先 / イベント列（任意）"
                headers={table.headers}
                value={mapping.usage ?? ""}
                onChange={(usage) => setMapping({ ...mapping, usage: usage || undefined })}
                allowEmpty
              />
              <ColumnField
                label="費目列（任意）"
                headers={table.headers}
                value={mapping.costType ?? ""}
                onChange={(costType) =>
                  setMapping({ ...mapping, costType: costType || undefined })
                }
                allowEmpty
              />
              <ColumnField
                label="個人支出列（任意）"
                headers={table.headers}
                value={mapping.personalAmount ?? ""}
                onChange={(personalAmount) =>
                  setMapping({ ...mapping, personalAmount: personalAmount || undefined })
                }
                allowEmpty
              />
              <ColumnField
                label="生活費列（任意）"
                headers={table.headers}
                value={mapping.livingAmount ?? ""}
                onChange={(livingAmount) =>
                  setMapping({ ...mapping, livingAmount: livingAmount || undefined })
                }
                allowEmpty
              />
              <Field
                label="既定の決済手段"
                hint="決済手段列が無いときに全行へ適用します"
              >
                <Select
                  value={defaultPaymentMethodId}
                  onChange={(e) => setDefaultPaymentMethodId(e.target.value)}
                >
                  <option value="">未設定</option>
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <Field label="この設定をプリセットとして保存" className="w-56">
                <Input
                  placeholder="例: 楽天カード"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
              </Field>
              <Button size="sm" onClick={savePreset} disabled={!presetName.trim()}>
                <Save size={14} />
                保存
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {mappedRows.length > 0 ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>3. 分類を確認して取り込む</CardTitle>
            <span className="text-xs text-fg-muted">
              有効 {validRows.length} 行 / カテゴリ割当済み {assignedCount} 行
            </span>
          </CardHeader>
          <CardBody className="space-y-3">
            {mapping.usage ? (
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-2/50 p-3">
                <Field
                  label="新しい使用先を入れる大項目"
                  className="w-48"
                  hint="使用先と同じ名前の中項目があればそれを使い、無い名前だけをこの大項目の下に作ります。"
                >
                  <Select
                    value={usageMajorId}
                    onChange={(e) => setUsageMajorId(e.target.value)}
                  >
                    <option value="">選択してください</option>
                    {majors.map((major) => (
                      <option key={major.id} value={major.id}>
                        {major.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {mapping.livingAmount ? (
                  <Field
                    label="生活費ぶんを入れる大項目"
                    className="w-48"
                    hint="同じ使用先の中項目をこの大項目にも作り、そちらへ生活費ぶんを入れます。"
                  >
                    <Select
                      value={livingMajorId}
                      onChange={(e) => setLivingMajorId(e.target.value)}
                    >
                      <option value="">選択してください</option>
                      {majors.map((major) => (
                        <option key={major.id} value={major.id}>
                          {major.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="未マッチ行の既定カテゴリ"
                className="w-56"
                hint="ルールに当たらなかった行に入ります"
              >
                <Select
                  value={fallbackCategoryId}
                  onChange={(e) => setFallbackCategoryId(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {majors.map((major) => (
                    <optgroup key={major.id} label={major.name}>
                      {major.categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Button size="sm" onClick={runClassify} disabled={pending}>
                自動分類する
              </Button>
            </div>

            <PreviewTable
              rows={mappedRows}
              majors={majors}
              costTypes={costTypes}
              categoryByRow={categoryByRow}
              costTypeByRow={costTypeByRow}
              incomeByRow={incomeByRow}
              onCategoryChange={(rowIndex, categoryId) =>
                setCategoryByRow((prev) => ({ ...prev, [rowIndex]: categoryId }))
              }
              onCostTypeChange={(rowIndex, costTypeId) =>
                setCostTypeByRow((prev) => ({ ...prev, [rowIndex]: costTypeId }))
              }
              onToggleIncome={(rowIndex) => {
                const row = validRows.find((r) => r.rowIndex === rowIndex);
                if (row) toggleIncome(row);
              }}
            />

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                onClick={commit}
                disabled={pending || assignedCount === 0}
              >
                <Upload size={14} />
                {assignedCount} 件を取り込む
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={allowDuplicate}
                  onChange={(e) => setAllowDuplicate(e.target.checked)}
                />
                重複チェックに引っかかる行も取り込む
              </label>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {message ? (
        <p role="status" className="rounded-xl border-[3px] border-blue-900 bg-white px-4 py-3 text-sm text-solid-gray-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border-[3px] border-error-1 bg-white px-4 py-3 text-sm text-error-1">
          {error}
        </p>
      ) : null}

      {recentBatches.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>最近の取り込み</CardTitle>
          </CardHeader>
          <CardBody className="px-0 pb-0">
            <ul className="divide-y divide-border border-t border-border text-sm">
              {recentBatches.map((batch) => (
                <li key={batch.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{batch.fileName}</span>
                  <span className="tabular shrink-0 text-xs text-fg-muted">
                    {batch.importedCount} 件取込 / {batch.skippedCount} 件スキップ
                  </span>
                  <span className="tabular hidden shrink-0 text-xs text-fg-muted sm:block">
                    {batch.createdAt.slice(0, 10).replace(/-/g, "/")}
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => undoBatch(batch)}
                    aria-label={`${batch.fileName} の取り込みを取り消す`}
                  >
                    <Trash2 size={13} />
                    取消
                  </Button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function ColumnField({
  label,
  headers,
  value,
  onChange,
  allowEmpty,
}: {
  label: string;
  headers: string[];
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allowEmpty ? "使わない" : "列を選択"}</option>
        {headers.map((header) => (
          <option key={header} value={header}>
            {header}
          </option>
        ))}
      </Select>
    </Field>
  );
}
