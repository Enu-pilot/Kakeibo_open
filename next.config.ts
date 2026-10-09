import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * GitHub Codespaces では、ブラウザは https://<名前>-3000.app.github.dev 経由で
   * 開発サーバーに届く。Next.js は開発時に localhost 以外からの開発用リソース
   * （画面の JS・ホットリロード）へのアクセスを既定で遮断するため、許可しておく。
   * 開発サーバー（npm run dev）にしか効かず、本番ビルドには影響しない。
   */
  allowedDevOrigins: ["*.app.github.dev"],
};

export default nextConfig;
