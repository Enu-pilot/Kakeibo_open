import { AppNav } from "@/components/app-nav";
import { snapshotLoadedAt } from "@/lib/db/store";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav loadedAt={snapshotLoadedAt()} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
