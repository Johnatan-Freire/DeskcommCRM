"use client";

/**
 * A chave geral dos follow-ups (migration 0657). Pausado, nada anda: as inscrições
 * vivas ficam paradas no passo em que estavam e voltam de onde pararam ao retomar;
 * inscrição que nasceria durante a pausa nasce cancelada. A faixa fica visível para
 * TODA a equipe enquanto durar — pausa que só quem clicou enxerga vira "por que o
 * follow-up não saiu?" (a lição do canal pausado, #2389).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Pause, Play } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { pausarTodosOsFollowupsAction, retomarTodosOsFollowupsAction } from "../_actions";

const MARCADOR_DO_INSTANTE = "{quando}";

export function PausaGeralDosFollowups({
  pausadosEm,
  podePausar,
  podeRetomar,
}: {
  /** ISO do instante da pausa; null = follow-ups funcionando. */
  pausadosEm: string | null;
  podePausar: boolean;
  podeRetomar: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [isPending, startTransition] = useTransition();
  const pausado = pausadosEm !== null;
  const faixa = pausadosEm
    ? t(
        "Todos os follow-ups estão pausados desde {quando}. Nenhum passo anda, ninguém é inscrito e nenhuma mensagem automática de follow-up sai.",
      ).replace(MARCADOR_DO_INSTANTE, new Date(pausadosEm).toLocaleString())
    : null;

  const executar = () => {
    startTransition(async () => {
      const res = pausado ? await retomarTodosOsFollowupsAction() : await pausarTodosOsFollowupsAction();
      if (!res.ok) {
        toast.error(res.message ?? t("Não foi possível mudar a pausa dos follow-ups."));
      } else {
        toast.success(pausado ? t("Follow-ups retomados.") : t("Follow-ups pausados."));
      }
      setAberto(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="pausa-geral-dos-followups">
      {pausado ? (
        <div
          role="status"
          className="rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-text"
          data-testid="faixa-followups-pausados"
        >
          {faixa}
        </div>
      ) : null}
      {(pausado ? podeRetomar : podePausar) ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => setAberto(true)}
            data-testid={pausado ? "retomar-todos-os-followups" : "pausar-todos-os-followups"}
          >
            {pausado ? (
              <>
                <Play size={14} aria-hidden className="mr-2" /> {t("Retomar todos os follow-ups")}
              </>
            ) : (
              <>
                <Pause size={14} aria-hidden className="mr-2" /> {t("Pausar todos os follow-ups")}
              </>
            )}
          </Button>
        </div>
      ) : null}

      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pausado ? t("Retomar todos os follow-ups?") : t("Pausar todos os follow-ups?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pausado
                ? t(
                    "Os follow-ups em andamento continuam do passo em que pararam, respeitando a janela de envio. Os que seriam iniciados durante a pausa não voltam.",
                  )
                : t(
                    "Nenhum follow-up anda enquanto estiver pausado: os em andamento ficam parados no passo atual e nenhum contato novo é inscrito. Só um administrador pode retomar.",
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                executar();
              }}
              data-testid="confirmar-pausa-dos-followups"
            >
              {pausado ? t("Retomar") : t("Pausar")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
