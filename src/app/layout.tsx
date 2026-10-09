import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

/**
 * デジタル庁デザインシステムの書体。next/font がビルド時に取得してアプリと一緒に配信するので、
 * 画面を開くたびに Google へ問い合わせることはない。
 */
const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-noto-sans-jp",
});

export const metadata: Metadata = {
  title: "家計簿",
  description:
    "カード・PayPay・現金の明細を取り込み、生活費/個人支出/投資/帳尻合わせに分類して集計する家計簿",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`h-full ${notoSansJp.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
