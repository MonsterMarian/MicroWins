"use client";

import * as React from "react";
import { Eye, EyeOff, Loader2, LogIn, UserPlus, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useAccount } from "@/components/providers/use-account";
import { useToast } from "@/components/providers/toast-provider";
import {
  ACCOUNT_EXISTS,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  PASSWORD_MIN,
  signIn,
  signUp,
  WRONG_PASSWORD,
} from "@/lib/account";
import { logoImage } from "@/lib/logo-image";
import { tapFeedback } from "@/lib/native";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

const MODES: { id: Mode; label: string }[] = [
  { id: "signin", label: "Přihlásit se" },
  { id: "signup", label: "Nový účet" },
];

/**
 * Vstup do appky - bez účtu se dál nejde.
 *
 * Data žijí v databázi účtu. V telefonu je jejich kopie, takže bez signálu
 * se pracuje dál a změny odejdou, až se spojí. Proto se tu přihlašuje jen
 * jednou na zařízení: přihlášení vydrží i bez sítě (viz `initAccount`).
 *
 * Žádný potvrzovací e-mail: účet vznikne hned a rovnou se do něj přihlásí.
 * Obě cesty jsou pod jedním přepínačem, protože se liší jen tlačítkem - a kdo
 * se splete (zakládá účet, který už má), dostane nabídku přepnout se.
 */
export function LoginScreen() {
  const account = useAccount();
  const { toast } = useToast();
  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const online = useOnline();
  const passwordRef = React.useRef<HTMLInputElement>(null);

  const off = account.status === "off";
  const signup = mode === "signup";
  const ready = isValidEmail(email) && isValidPassword(password) && !busy && !off && online;

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const res = signup ? await signUp(email, password) : await signIn(email, password);
    setBusy(false);
    if (res.ok) {
      void tapFeedback();
      toast({
        tone: "info",
        title: signup ? "Účet založený" : "Přihlášeno",
        description: normalizeEmail(email),
      });
      return;
    }
    setError(res.message);
  };

  return (
    <main className="mw-safe-x flex min-h-[100dvh] items-center justify-center px-4 pb-[calc(1rem+var(--mw-safe-bottom))] pt-[calc(1rem+var(--mw-safe-top))]">
      <form
        className="animate-in-up flex w-full max-w-sm flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- statický export, bez optimalizace obrázků */}
          <img src={logoImage} alt="" className="size-14 object-contain" />
          <h1 className="text-xl font-semibold tracking-tight">MicroWins</h1>
          <p className="text-sm text-muted-foreground">
            Data se ukládají do účtu, takže je máš na každém zařízení. Bez signálu appka jede dál
            a změny odejdou později.
          </p>
        </div>

        <div className="flex gap-1 border-b" role="tablist">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              onClick={() => switchTo(m.id)}
              aria-selected={mode === m.id}
              className={cn(
                "-mb-px flex-1 border-b-2 px-3 py-2 text-sm transition-colors",
                mode === m.id
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {!online ? (
          <p className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <WifiOff className="size-4 shrink-0" />
            Bez připojení se přihlásit nejde. Po prvním přihlášení už appka pojede i offline.
          </p>
        ) : null}

        <Field label="E-mail" htmlFor="login-email">
          <Input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            value={email}
            placeholder="jmeno@example.cz"
            disabled={off}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || password !== "") return;
              e.preventDefault();
              passwordRef.current?.focus();
            }}
          />
        </Field>

        <Field
          label="Heslo"
          htmlFor="login-password"
          hint={
            signup
              ? `Aspoň ${PASSWORD_MIN} znaků. Zapamatuj si ho - obnovit heslo e-mailem zatím nejde.`
              : undefined
          }
        >
          <div className="relative">
            <Input
              ref={passwordRef}
              id="login-password"
              type={visible ? "text" : "password"}
              autoComplete={signup ? "new-password" : "current-password"}
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="go"
              value={password}
              disabled={off}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              disabled={off}
              aria-label={visible ? "Skrýt heslo" : "Ukázat heslo"}
              aria-pressed={visible}
              className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        {error ? (
          <div className="flex flex-col items-start gap-1">
            <p className="text-xs text-destructive">{error}</p>
            {/* Nejčastější omyl: zakládá účet, který už má - nebo se hlásí do
                účtu, který ještě nezaložil. Jedno ťuknutí na druhou cestu. */}
            {signup && error === ACCOUNT_EXISTS ? (
              <button
                type="button"
                onClick={() => switchTo("signin")}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Přepnout na přihlášení
              </button>
            ) : !signup && error === WRONG_PASSWORD ? (
              <button
                type="button"
                onClick={() => switchTo("signup")}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Ještě nemáš účet? Založ si ho
              </button>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" size="lg" disabled={!ready}>
          {busy ? <Loader2 className="animate-spin" /> : signup ? <UserPlus /> : <LogIn />}
          {busy ? (signup ? "Zakládám…" : "Přihlašuju…") : signup ? "Založit účet" : "Přihlásit"}
        </Button>
      </form>
    </main>
  );
}

/** Je zařízení online? Při změně se přepne samo. */
function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/**
 * Brána appky: přihlášený vidí appku, ostatní přihlášení. Než se zjistí,
 * kdo je přihlášený (načtení knihovny účtu), stojí na místě tichá plocha
 * se značkou - probliknutí přihlášení u přihlášeného by vypadalo jako
 * odhlášení.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const account = useAccount();
  if (account.status === "signed-in") return <>{children}</>;
  if (account.status === "loading") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center" aria-busy>
        {/* eslint-disable-next-line @next/next/no-img-element -- statický export, bez optimalizace obrázků */}
        <img src={logoImage} alt="" className="size-12 animate-pulse object-contain opacity-60" />
      </main>
    );
  }
  return <LoginScreen />;
}

/**
 * Nové přihlášení, když databáze to staré zrušila (změna hesla, zneplatněný
 * token). Appka mezitím jela dál a změny čekají v telefonu - tady se jen
 * zadá heslo ke stejnému účtu a synchronizace se rozjede sama.
 */
export function ReloginDialog({
  email,
  open,
  onOpenChange,
}: {
  email: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const online = useOnline();

  React.useEffect(() => {
    if (!open) return;
    setPassword("");
    setError(null);
  }, [open]);

  const ready = isValidPassword(password) && !busy && online;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.ok) {
      void tapFeedback();
      toast({ tone: "info", title: "Přihlášeno znovu", description: "Čekající změny odcházejí." });
      onOpenChange(false);
      return;
    }
    setError(res.message);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Přihlásit znovu"
      description={email}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button disabled={!ready} onClick={() => void submit()}>
            {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
            {busy ? "Přihlašuju…" : "Přihlásit"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {!online ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <WifiOff className="size-4 shrink-0" /> Bez připojení se přihlásit nejde.
          </p>
        ) : null}
        <Field label="Heslo" htmlFor="relogin-password">
          <Input
            id="relogin-password"
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </Field>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  );
}
