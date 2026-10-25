"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { formatDistanceToNowStrict } from "date-fns";
import { useT } from "@/hooks/i18n/useT";
import { ArrowsClockwise, CaretDown, CaretUp, Scales, ShieldCheck, X } from "@/lib/ui/icons";
import { retentionCopy, type RetentionKind } from "@/lib/inbox/retention-copy";
import { useRetention } from "@/hooks/inbox/useRetention";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<RetentionKind, typeof ShieldCheck> = {
  protection: ShieldCheck,
  compliance: Scales,
  quality: ArrowsClockwise,
};

const KIND_CLASS: Record<RetentionKind, string> = {
  protection: "border-warning bg-warning-bg text-warning-fg",
  compliance: "border-destructive/40 bg-destructive/10 text-destructive",
  quality: "border-border bg-muted/40 text-muted-foreground",
};

/**
 * Qual retenção cada conversa já teve o aviso fechado — `{ conversa: id da retenção }`.
 *
 * Guardar o ID da RETENÇÃO, e não um "fechado" por conversa, é o que faz o aviso
 * voltar sozinho quando o número segura OUTRA resposta: fechar o de hoje não pode
 * esconder o de amanhã. É conveniência de quem olha a tela (localStorage), não
 * estado do produto: navegador sem armazenamento só volta a mostrar o aviso.
 */
const CHAVE_FECHADOS = "inbox:avisos-de-retencao-fechados";

/** Avisa as instâncias abertas nesta aba; o evento `storage` só cobre as OUTRAS abas. */
const EVENTO_FECHADOS = "inbox:avisos-de-retencao-fechados";

/**
 * Fechados guardados SÓ nesta tela, para quando o navegador recusa o
 * armazenamento: o X tem de funcionar mesmo assim, ainda que não sobreviva ao F5.
 */
let fechadosEmMemoria = "{}";

function lerBruto(): string {
  try {
    return window.localStorage.getItem(CHAVE_FECHADOS) ?? "{}";
  } catch {
    return fechadosEmMemoria;
  }
}

function interpretar(bruto: string): Record<string, string> {
  try {
    const valor: unknown = JSON.parse(bruto);
    return valor && typeof valor === "object" ? (valor as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function assinar(avisar: () => void): () => void {
  window.addEventListener("storage", avisar);
  window.addEventListener(EVENTO_FECHADOS, avisar);
  return () => {
    window.removeEventListener("storage", avisar);
    window.removeEventListener(EVENTO_FECHADOS, avisar);
  };
}

function gravarFechados(fechados: Record<string, string>): void {
  fechadosEmMemoria = JSON.stringify(fechados);
  try {
    window.localStorage.setItem(CHAVE_FECHADOS, fechadosEmMemoria);
  } catch {
    // Sem armazenamento o fechamento vale só enquanto a tela estiver aberta.
  }
  window.dispatchEvent(new Event(EVENTO_FECHADOS));
}

/**
 * Aviso de transparência do anti-ban (Operação Visível F2-i): quando a cadeia
 * before_send reteve a resposta do assistente nas últimas 24h, mostra o MOTIVO
 * traduzido em pt-br leigo acima do composer. Sem veto recente → não renderiza.
 *
 * COMPACTO POR PADRÃO. Aberto, o aviso de aquecimento ocupava quatro linhas
 * entre o fio e o composer e escondia a conversa justo em quem está atendendo.
 * Agora é uma linha (o que aconteceu e quando); a explicação abre em "Ver
 * detalhes", e o X fecha o aviso até a próxima retenção.
 */
export function RetentionNotice({ conversationId }: { conversationId: string }) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const { data } = useRetention(conversationId);
  const [aberto, setAberto] = useState(false);
  // O servidor não tem navegador: ele desenha o aviso, e o cliente esconde depois
  // de hidratar, sem divergir do HTML (ver `lib/theme.tsx`).
  const bruto = useSyncExternalStore(assinar, lerBruto, () => "{}");
  const fechados = useMemo(() => interpretar(bruto), [bruto]);
  const latest = data?.retentions[0];
  if (!latest || !data) return null;
  if (fechados[conversationId] === latest.id) return null;

  const copy = retentionCopy(latest.vetoed_code, data.context, t);
  const Icon = KIND_ICON[copy.kind];
  const when = formatDistanceToNowStrict(new Date(latest.created_at), {
    addSuffix: true,
    locale: localeDaData,
  });

  function fechar() {
    if (!latest) return;
    gravarFechados({ ...interpretar(lerBruto()), [conversationId]: latest.id });
  }

  return (
    <div
      data-testid="retention-notice"
      className={cn("flex items-start gap-2 border-t px-4 py-1.5 text-xs", KIND_CLASS[copy.kind])}
    >
      <Icon size={14} weight="duotone" className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 truncate font-medium">
            {copy.title}
            <span className="ml-2 font-normal opacity-70">{when}</span>
          </p>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            data-testid="retention-notice-detalhes"
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 underline-offset-2 opacity-80 hover:underline hover:opacity-100"
          >
            {aberto ? t("Ocultar detalhes") : t("Ver detalhes")}
            {aberto ? <CaretUp size={12} aria-hidden /> : <CaretDown size={12} aria-hidden />}
          </button>
          <button
            type="button"
            onClick={fechar}
            aria-label={t("Fechar aviso")}
            title={t("Fechar aviso")}
            data-testid="retention-notice-fechar"
            className="shrink-0 rounded-md p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        {aberto && <p className="mt-1 opacity-90">{copy.description}</p>}
      </div>
    </div>
  );
}
