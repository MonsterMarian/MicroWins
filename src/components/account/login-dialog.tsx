"use client";

import * as React from "react";
import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
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
import { tapFeedback } from "@/lib/native";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

const MODES: { id: Mode; label: string }[] = [
  { id: "signin", label: "Přihlásit se" },
  { id: "signup", label: "Nový účet" },
];

/**
 * Přihlášení a založení účtu - e-mail a heslo, nic víc.
 *
 * Žádný potvrzovací e-mail: účet vznikne hned a rovnou se do něj přihlásí.
 * Obě cesty jsou v jednom dialogu pod přepínačem, protože se liší jen jedním
 * tlačítkem - a kdo se splete (zakládá účet, který už má), dostane nabídku
 * přepnout se, místo aby musel dialog zavírat.
 */
export function LoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const account = useAccount();
  const { toast } = useToast();
  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [visible, setVisible] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  const off = account.status === "off";
  const signup = mode === "signup";

  // Každé otevření začíná přihlášením a s prázdným heslem. Adresa zůstává,
  // ať se po překlepu v hesle nemusí psát znovu.
  React.useEffect(() => {
    if (!open) return;
    setMode("signin");
    setPassword("");
    setVisible(false);
    setError(null);
  }, [open]);

  const ready = isValidEmail(email) && isValidPassword(password) && !busy && !off;

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
      onOpenChange(false);
      return;
    }
    setError(res.message);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={signup ? "Založit účet" : "Přihlásit se"}
      description={
        signup ? "Účet vznikne hned, bez potvrzovacího e-mailu." : "E-mail a heslo k tvému účtu."
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button disabled={!ready} onClick={submit}>
            {signup ? <UserPlus /> : <LogIn />}
            {busy ? (signup ? "Zakládám…" : "Přihlašuju…") : signup ? "Založit účet" : "Přihlásit"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Stejné záložky jako v Nastavení - přepínač, ne dva dialogy. */}
        <div className="flex gap-1 border-b">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => switchTo(m.id)}
              aria-pressed={mode === m.id}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                mode === m.id
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {off ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            Účty zatím nejsou napojené na databázi. Appka mezitím jede dál bez účtu a data zůstávají
            v tomhle zařízení.
          </div>
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
              if (e.key !== "Enter") return;
              if (password === "") passwordRef.current?.focus();
              else void submit();
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
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
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
      </div>
    </Dialog>
  );
}
