import { loadSnapshotForPage } from "@/lib/db/store";
import { SetupError } from "@/components/setup-error";
import {
  activeCostTypes,
  activePurposes,
  activePaymentMethods,
  majorsWithCategories,
  toCostTypeView,
  toPaymentMethodView,
} from "@/lib/db/queries";
import { getAccountBalances } from "@/lib/balances";
import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;
  const db = loaded.db;

  return (
    <SettingsView
      majors={majorsWithCategories(db)}
      purposes={activePurposes(db)}
      costTypes={activeCostTypes(db).map(toCostTypeView)}
      rules={[...db.rules]
        .sort((a, b) => a.priority - b.priority || a.keyword.localeCompare(b.keyword, "ja"))
        .map((rule) => ({
          id: rule.id,
          keyword: rule.keyword,
          matchType: rule.matchType,
          priority: rule.priority,
          enabled: rule.enabled,
          isLearned: rule.isLearned,
          categoryId: rule.categoryId,
          costTypeId: rule.costTypeId,
        }))}
      paymentMethods={activePaymentMethods(db).map(toPaymentMethodView)}
      balances={getAccountBalances(db)}
      presets={[...db.presets]
        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
        .map((preset) => ({ id: preset.id, name: preset.name }))}
    />
  );
}
