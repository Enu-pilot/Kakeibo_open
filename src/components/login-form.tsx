"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.ok) {
      router.replace(params.get("next") ?? "/");
      router.refresh();
    } else {
      const data = await response.json().catch(() => ({}));
      setError(data.error ?? "ログインに失敗しました");
      setPending(false);
    }
  }

  return (
    <Card>
      <CardBody className="pt-5">
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="パスワード">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </Field>
          {error ? (
            <p role="alert" className="text-dns-16N-130 text-error-1">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" className="min-h-12 w-full" disabled={pending}>
            {pending ? "確認中..." : "ログイン"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
