"use client";

import { useState } from "react";
import { CircleNotch, Eye, EyeSlash, SignIn } from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/FormField";

export default function LoginPage() {
  const { login } = useAuth();
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
      setError(err instanceof Error ? err.message : "Erreur de connexion.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <aside className="relative flex flex-col justify-between bg-gradient-to-br from-brand-navy to-brand-navy-dark px-8 py-10 text-white lg:w-[42%] lg:min-h-screen lg:px-12 lg:py-14">
        <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
          <BrandLogo variant="syskern" className="max-h-12 brightness-0 invert" />
          <p className="mt-10 max-w-sm text-2xl font-bold leading-snug tracking-tight lg:text-3xl">
            Pricing câble, une ligne.
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/70">
            Simulez, tarifez et générez vos offres à partir du catalogue PIM — sans Excel.
          </p>
        </div>
        <div className="mt-10 hidden flex-col gap-2 lg:flex">
          <p className="text-xs text-white/50">Une solution Unikkern</p>
          <BrandLogo variant="unnikkern" className="h-7 min-w-0 brightness-0 invert opacity-90" />
        </div>
      </aside>

      <div className="flex flex-1 flex-col items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300 motion-safe:slide-in-from-bottom-2">
          <div className="mb-8 flex justify-center lg:hidden">
            <BrandLogo variant="syskern" />
          </div>

          <Card className="shadow-[var(--shadow-elevated)]">
            <CardHeader>
              <CardTitle>Connexion</CardTitle>
              <CardDescription>Accédez à votre espace de travail.</CardDescription>
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
                <FormField label="Adresse e-mail" htmlFor="email" required>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="vous@exemple.com"
                  />
                </FormField>

                <FormField label="Mot de passe" htmlFor="password" required>
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
                      aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
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
                  {loading ? "Connexion..." : "Se connecter"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <footer className="mt-8 flex flex-col items-center gap-2 text-center lg:hidden">
            <p className="text-xs text-muted-foreground">Une solution Unikkern</p>
            <BrandLogo variant="unnikkern" className="h-8 min-w-0" />
          </footer>
        </div>
      </div>
    </div>
  );
}
