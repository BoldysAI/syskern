"use client";

import { useState } from "react";
import { CircleNotch, Eye, EyeSlash, SignIn } from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import { translate } from "@/lib/i18n";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/FormField";

export default function LoginPage() {
  const { login, displayLanguage } = useAuth();
  const t = (key: Parameters<typeof translate>[0], vars?: Record<string, string | number>) =>
    translate(key, displayLanguage, vars);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("login.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <BrandLogo variant="syskern" className="max-h-12" />

        <Card className="w-full shadow-[var(--shadow-elevated)]">
          <CardHeader>
            <CardTitle>{t("login.title")}</CardTitle>
            <CardDescription>{t("login.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <FormField label={t("login.email")} htmlFor="email" required>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("login.emailPlaceholder")}
                />
              </FormField>

              <FormField label={t("login.password")} htmlFor="password" required>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={
                      showPassword ? t("login.hidePassword") : t("login.showPassword")
                    }
                  >
                    {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </FormField>

              <Button type="submit" disabled={loading} className="mt-2 h-10 w-full">
                {loading ? (
                  <CircleNotch size={16} className="animate-spin" />
                ) : (
                  <SignIn size={16} weight="bold" />
                )}
                {loading ? t("login.submitting") : t("login.submit")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <BrandLogo variant="unnikkern" className="h-8 min-w-0" />
      </div>
    </div>
  );
}
