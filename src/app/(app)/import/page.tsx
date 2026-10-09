import { loadSnapshotForPage } from "@/lib/db/store";
import { SetupError } from "@/components/setup-error";
import {
  activeCostTypes,
  activePaymentMethods,
  majorsWithCategories,
  toCostTypeView,
  toPaymentMethodView,
} from "@/lib/db/queries";
import { ImportWizard } from "@/components/import/import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;
  const db = loaded.db;

  return (
    <ImportWizard
      majors={majorsWithCategories(db)}
      paymentMethods={activePaymentMethods(db).map(toPaymentMethodView)}
      costTypes={activeCostTypes(db).map(toCostTypeView)}
      presets={[...db.presets]
        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
        .map((preset) => ({
          id: preset.id,
          name: preset.name,
          encoding: preset.encoding as "auto" | "UTF8" | "SJIS",
          skipRows: preset.skipRows,
          mapping: preset.mapping,
          defaultPaymentMethodId: preset.defaultPaymentMethodId,
        }))}
      recentBatches={[...db.batches]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
        .map((batch) => ({
          id: batch.id,
          fileName: batch.fileName,
          importedCount: batch.importedCount,
          skippedCount: batch.skippedCount,
          createdAt: batch.createdAt,
        }))}
    />
  );
}
