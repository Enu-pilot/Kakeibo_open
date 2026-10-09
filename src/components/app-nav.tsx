"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  ListOrdered,
  Upload,
  Table2,
  Target,
  Wallet,
  HeartHandshake,
  Sheet,
  Settings,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/transactions", label: "明細", icon: ListOrdered },
  { href: "/import", label: "取込", icon: Upload },
  { href: "/budget", label: "予実", icon: Target },
  { href: "/purposes", label: "使途", icon: Wallet },
  { href: "/pair", label: "二人", icon: HeartHandshake },
  { href: "/summary", label: "まとめ", icon: Table2 },
  { href: "/sheet", label: "シート", icon: Sheet },
  { href: "/settings", label: "設定", icon: Settings },
];

const TIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * ヘッダーとグローバルメニュー。
 * メニューはデジタル庁デザインシステムの HorizontalMenu と同じ見た目
 * （現在地は青い下線 4px、ホバーは黒い下線 2px）。
 */
export function AppNav({ loadedAt }: { loadedAt: number | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function reload() {
    setSyncing(true);
    setSyncError(null);
    try {
      await api("/api/sync", { method: "POST" });
      router.refresh();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "読み直せませんでした");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-solid-gray-420 bg-white">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 pt-2 sm:px-6">
        <Link
          href="/"
          className="text-std-20B-150 text-solid-gray-900 no-underline hover:underline"
        >
          家計簿
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={reload}
            disabled={syncing}
            className="flex min-h-9 items-center gap-1.5 rounded-[6px] border border-transparent px-2 text-dns-14N-130 text-solid-gray-800 hover:border-solid-gray-900 hover:bg-solid-gray-50 disabled:text-solid-gray-420"
            title="スプレッドシートを直接直したときに、30 秒を待たずに読み直します"
          >
            <RefreshCw size={16} aria-hidden className={syncing ? "animate-spin" : undefined} />
            <span>
              {syncing
                ? "読み直しています…"
                : loadedAt
                  ? `${TIME.format(loadedAt)} に読み込み`
                  : "スプレッドシートから読み直す"}
            </span>
          </button>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="flex min-h-9 items-center gap-1.5 rounded-[6px] border border-transparent px-2 text-dns-14N-130 text-solid-gray-800 hover:border-solid-gray-900 hover:bg-solid-gray-50"
            >
              <LogOut size={16} aria-hidden />
              <span className="sr-only sm:not-sr-only">ログアウト</span>
            </button>
          </form>
        </div>
      </div>
      {syncError ? (
        <p role="alert" className="mx-auto max-w-7xl px-4 pb-1 text-dns-14N-130 text-error-1 sm:px-6">
          {syncError}
        </p>
      ) : null}
      <nav aria-label="メインメニュー" className="mx-auto w-full max-w-7xl overflow-x-auto px-2 sm:px-4">
        <ul className="flex items-stretch text-dns-16B-130 text-solid-gray-900">
          {LINKS.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <li key={link.href} className="flex">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-12 shrink-0 items-center gap-1.5 px-3 py-2 whitespace-nowrap no-underline sm:px-4 focus-inset",
                    "hover:bg-solid-gray-50 hover:after:absolute hover:after:inset-x-0 hover:after:bottom-0 hover:after:border-b-2 hover:after:border-black hover:after:content-['']",
                    active &&
                      "text-key-1000 after:absolute after:inset-x-0 after:bottom-0 after:border-b-4 after:border-key-900 after:content-[''] hover:after:border-b-4 hover:after:border-key-900",
                  )}
                >
                  <Icon size={18} aria-hidden />
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
