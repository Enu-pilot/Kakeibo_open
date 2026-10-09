import { SheetView } from "@/components/sheet/sheet-view";
import { defaultSpreadsheetId, isSheetsConfigured } from "@/lib/google-sheets";
import { loadSnapshotForPage } from "@/lib/db/store";
import { majorsWithCategories } from "@/lib/db/queries";
import { SetupError } from "@/components/setup-error";

export const dynamic = "force-dynamic";

/**
 * シート版ダッシュボード。
 * 読むだけではどこにも書き込まない。「アプリに取り込む」を押したときだけ、アプリのデータに書き込む。
 */
export default async function SheetPage() {
  const loaded = await loadSnapshotForPage();
  if ("error" in loaded) return <SetupError message={loaded.error} />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-std-28B-150 text-solid-gray-900">シート</h1>
        <p className="text-sm text-fg-muted">
          GAS 時代の請求シートを読んで集計し、アプリのデータと突き合わせます。確かめたうえで、過去の明細をアプリに取り込めます。
        </p>
      </div>
      <SheetView
        sheetsConfigured={isSheetsConfigured()}
        defaultSpreadsheetId={defaultSpreadsheetId()}
        majors={majorsWithCategories(loaded.db)}
      />
    </div>
  );
}
