import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * 画面の基本部品。見た目はデジタル庁デザインシステム（DADS）のコードスニペットに合わせている。
 * https://github.com/digital-go-jp/design-system-example-components-react
 * フォーカスの黒枠＋黄色リングは globals.css で全体にかけている。
 */

/* ---------- Card ---------- */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-xl border border-solid-gray-420 bg-white", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pt-5 pb-3", className)} {...props} />;
}

/** カードの見出し。DADS の見出しと同じく、左に青い目印（チップ）を付ける */
export function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn(
        "relative pl-3 text-std-18B-160 text-solid-gray-900",
        "before:absolute before:top-[0.3em] before:bottom-[0.3em] before:left-0 before:w-1 before:rounded-full before:bg-key-900",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

/* ---------- Button ---------- */
type ButtonProps = React.ComponentProps<"button"> & {
  /** primary = 塗り（solid-fill）、secondary = 枠線（outline）、ghost = アイコン・補助操作、danger = 削除 */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** md = DADS の sm（高さ 36px）、sm = DADS の xs（高さ 28px） */
  size?: "sm" | "md";
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1 font-bold underline-offset-[3px] transition-colors",
        "disabled:pointer-events-none",
        size === "sm"
          ? "min-h-7 rounded-md px-2 text-oln-14B-100"
          : "min-h-9 rounded-[6px] px-3 text-oln-16B-100",
        variant === "primary" &&
          "border-4 border-double border-transparent bg-key-900 text-white hover:bg-key-1000 hover:underline active:bg-key-1200 disabled:bg-solid-gray-300 disabled:text-solid-gray-50",
        variant === "secondary" &&
          "border border-key-900 bg-white text-key-900 hover:bg-key-200 hover:text-key-1000 hover:underline active:bg-key-300 disabled:border-solid-gray-300 disabled:text-solid-gray-300",
        variant === "ghost" &&
          "border border-transparent text-solid-gray-800 hover:border-solid-gray-900 hover:bg-solid-gray-50 disabled:text-solid-gray-300",
        variant === "danger" &&
          "border border-error-1 bg-white text-error-1 hover:bg-red-50 hover:text-red-1000 hover:underline disabled:border-solid-gray-300 disabled:text-solid-gray-300",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Form controls ---------- */
const fieldClass =
  "h-10 w-full rounded-lg border border-solid-gray-600 bg-white px-3 text-oln-16N-100 text-solid-gray-800 " +
  "placeholder:text-solid-gray-420 hover:border-black " +
  "aria-[invalid=true]:border-error-1 " +
  "disabled:border-solid-gray-300 disabled:bg-solid-gray-50 disabled:text-solid-gray-420";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClass, className)} {...props} />;
}

/** DADS の Select と同じく、矢印を自前で描く */
export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        fieldClass,
        "appearance-none bg-[length:16px] bg-[right_0.625rem_center] bg-no-repeat pr-9",
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%231a1a1a' d='M13.3344 4.40002L8.00104 9.73336L2.66771 4.40002L1.73438 5.33336L8.00104 11.6L14.2677 5.33336L13.3344 4.40002Z'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldClass, "h-auto min-h-[96px] py-2 text-std-16N-170", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1 block text-std-16B-170 text-solid-gray-800", className)}
      {...props}
    />
  );
}

/** ラベル＋入力欄＋補足（DADS の SupportText）をまとめたもの */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-solid-gray-600">{hint}</p> : null}
    </div>
  );
}

/* ---------- Badge（DADS の ChipLabel filled-1 相当） ---------- */
const BADGE_TONE = {
  gray: "border-solid-gray-536 bg-solid-gray-50 text-solid-gray-800",
  blue: "border-blue-700 bg-blue-50 text-blue-800",
  green: "border-green-800 bg-green-50 text-green-900",
  red: "border-red-900 bg-red-50 text-red-900",
  yellow: "border-yellow-800 bg-yellow-50 text-yellow-1000",
} as const;

export function Badge({
  className,
  tone = "gray",
  ...props
}: React.ComponentProps<"span"> & { tone?: keyof typeof BADGE_TONE }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-px text-xs font-bold leading-[1.4]",
        BADGE_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Empty / message ---------- */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-solid-gray-420 bg-white px-6 py-10 text-center">
      <p className="text-std-18B-160 text-solid-gray-900">{title}</p>
      {description ? (
        <p className="max-w-xl text-sm text-solid-gray-600">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
