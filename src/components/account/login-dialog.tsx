"use client";

import * as React from "react";
import { ArrowLeft, LogIn, Mail, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { useAccount } from "@/components/providers/use-account";
import { useToast } from "@/components/providers/toast-provider";
import {
  CODE_LENGTH,
  isValidEmail,
  normalizeCode,
  normalizeEmail,
  RESEND_SECONDS,
  sendCode,
  verifyCode,
} from "@/lib/account";
import { tapFeedback } from "@/lib/native";
import { cn } from "@/lib/utils";

type Step = "email" | "code";

/**
 * Přihlášení kódem z e-mailu, ve dvou krocích: adresa → kód.
 *
 * Heslo tu schválně není. Kód je jedno pole navíc jednou za čas, heslo by
 * bylo další věc k zapomenutí - a odkaz v mailu místo kódu by musel otevřít
 * appku, na což je potřeba nové APK (viz `lib/account.ts`).
 *
 * Účet, který ještě neexistuje, se založí sám - "registrace" a "přihlášení"
 * jsou pro člověka jedno a totéž: chci být přihlášený.
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
  const [step, setStep] = React.useState<Step>("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** Za kolik sekund jde poslat nový kód; 0 = hned. */
  const [cooldown, setCooldown] = React.useState(0);
  const codeRef = React.useRef<HTMLInputElement>(null);

  const off = account.status === "off";

  // Každé otevření začíná od adresy - rozepsaný kód z minula by jen mátl.
  // Adresa zůstává, ať se nemusí psát znovu.
  React.useEffect(() => {
    if (!open) return;
    setStep("email");
    setCode("");
    setError(null);
  }, [open]);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  React.useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const validEmail = isValidEmail(email);

  const send = async () => {
    if (!validEmail || busy || off) return;
    setBusy(true);
    setError(null);
    const res = await sendCode(email);
    setBusy(false);
    if (res.ok) {
      // Nový kód na žádost ruší ten starý - ať člověk ví, který opisovat.
      if (step === "code") toast({ tone: "info", title: "Poslali jsme nový kód", description: "Ten předchozí už neplatí." });
      setStep("code");
      setCode("");
      setCooldown(RESEND_SECONDS);
      return;
    }
    setError(res.message);
    if (res.retryIn) setCooldown(res.retryIn);
  };

  const verify = async (value: string) => {
    const token = normalizeCode(value);
    if (token.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    const res = await verifyCode(email, token);
    setBusy(false);
    if (res.ok) {
      void tapFeedback();
      toast({ tone: "info", title: "Přihlášeno", description: normalizeEmail(email) });
      onOpenChange(false);
      return;
    }
    // Špatný kód se smaže, ať se dá rovnou psát znovu.
    setError(res.message);
    setCode("");
    codeRef.current?.focus();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={step === "email" ? "Přihlásit se" : "Opiš kód z e-mailu"}
      description={
        step === "email" ? (
          "Bez hesla - na e-mail ti přijde kód."
        ) : (
          <>
            Poslali jsme ho na <span className="font-medium text-foreground">{normalizeEmail(email)}</span>.
            Platí hodinu.
          </>
        )
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          {step === "email" ? (
            <Button disabled={!validEmail || busy || off} onClick={send}>
              <Mail /> {busy ? "Posílám…" : "Poslat kód"}
            </Button>
          ) : (
            <Button disabled={code.length !== CODE_LENGTH || busy} onClick={() => verify(code)}>
              <LogIn /> {busy ? "Ověřuju…" : "Přihlásit"}
            </Button>
          )}
        </>
      }
    >
      {step === "email" ? (
        <div className="flex flex-col gap-3">
          {off ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              Účty zatím nejsou napojené na databázi. Appka mezitím jede dál bez účtu a data
              zůstávají v tomhle zařízení.
            </div>
          ) : null}

          <Field
            label="E-mail"
            htmlFor="login-email"
            hint="Když účet ještě nemáš, založí se sám. Nic z telefonu se tím nesmaže."
          >
            <Input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="send"
              value={email}
              placeholder="jmeno@example.cz"
              disabled={off}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
            />
          </Field>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          {/* Kdo dialog zavřel a otevřel znovu, má kód už v mailu - posílat
              nový by jen spálilo minutu čekání a starý by přestal platit. */}
          {validEmail && !off ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("code");
              }}
              className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Kód už mi přišel
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Kód" htmlFor="login-code">
            <Input
              ref={codeRef}
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              value={code}
              placeholder={"0".repeat(CODE_LENGTH)}
              aria-invalid={error !== null}
              onChange={(e) => {
                // Vložený text z mailu ("Kód: 123 456") se očistí na číslice
                // a plný kód se rovnou ověří - bez dalšího ťuknutí.
                const next = normalizeCode(e.target.value);
                setCode(next);
                setError(null);
                if (next.length === CODE_LENGTH) void verify(next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void verify(code);
              }}
              className={cn(
                "tabular h-12 text-center text-2xl font-semibold tracking-[0.5em] placeholder:tracking-[0.5em] placeholder:text-muted-foreground/40",
                error && "border-destructive",
              )}
            />
          </Field>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => {
                setError(null);
                setStep("email");
              }}
            >
              <ArrowLeft className="size-3.5" /> Jiný e-mail
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="tabular h-7 px-2"
              disabled={cooldown > 0 || busy}
              onClick={send}
            >
              <RotateCw className="size-3.5" />
              {cooldown > 0 ? `Poslat znovu za ${cooldown} s` : "Poslat znovu"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">Nepřišel? Mrkni i do spamu.</p>
        </div>
      )}
    </Dialog>
  );
}
