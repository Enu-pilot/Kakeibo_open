"use client";

import { useState } from "react";
import { Card, CardBody } from "@/components/ui";
import { CategorySettings } from "@/components/settings/category-settings";
import { RuleSettings } from "@/components/settings/rule-settings";
import { CostTypeSettings } from "@/components/settings/cost-type-settings";
import { PurposeSettings } from "@/components/settings/purpose-settings";
import { PaymentMethodSettings } from "@/components/settings/payment-method-settings";
import { PresetSettings } from "@/components/settings/preset-settings";
import { cn } from "@/lib/utils";
import type { CostTypeView, MajorWithCategories, PaymentMethodView, PurposeView } from "@/lib/view-types";
import type { AccountBalance } from "@/lib/balances";
import type { RuleView } from "@/components/settings/rule-settings";

const TABS = [
  { id: "purposes", label: "使途" },
  { id: "categories", label: "カテゴリ" },
  { id: "costTypes", label: "費目" },
  { id: "rules", label: "自動分類ルール" },
  { id: "methods", label: "決済手段" },
  { id: "presets", label: "取込プリセット" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsView({
  majors,
  purposes,
  costTypes,
  rules,
  paymentMethods,
  balances,
  presets,
}: {
  majors: MajorWithCategories[];
  purposes: PurposeView[];
  costTypes: CostTypeView[];
  rules: RuleView[];
  paymentMethods: PaymentMethodView[];
  balances: AccountBalance[];
  presets: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<TabId>("categories");

  return (
    <div className="space-y-4">
      <h1 className="text-std-28B-150 text-solid-gray-900">設定</h1>

      <div
        role="tablist"
        className="flex overflow-x-auto border-b border-solid-gray-420"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              // DADS のタブ: 選択中は青い下線 4px、それ以外はホバーで黒い下線
              "-mb-px min-h-12 shrink-0 border-b-4 px-4 py-2 text-dns-16B-130 focus-inset",
              tab === item.id
                ? "border-key-900 text-key-1000"
                : "border-transparent text-solid-gray-800 hover:border-solid-gray-900 hover:bg-solid-gray-50",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <Card>
        <CardBody className="pt-4">
          {tab === "purposes" ? <PurposeSettings purposes={purposes} majors={majors} /> : null}
          {tab === "categories" ? <CategorySettings majors={majors} purposes={purposes} /> : null}
          {tab === "costTypes" ? <CostTypeSettings costTypes={costTypes} /> : null}
          {tab === "rules" ? (
            <RuleSettings rules={rules} majors={majors} costTypes={costTypes} />
          ) : null}
          {tab === "methods" ? (
            <PaymentMethodSettings
              paymentMethods={paymentMethods}
              balances={balances}
            />
          ) : null}
          {tab === "presets" ? <PresetSettings presets={presets} /> : null}
        </CardBody>
      </Card>
    </div>
  );
}
