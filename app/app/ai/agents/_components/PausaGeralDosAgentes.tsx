"use client";

/**
 * Pausar / retomar TODOS os agentes de uma vez (auditoria de agentes, 14/10/2026).
 *
 * Os dois botões pedem confirmação: pausar todos tira a IA de todas as conversas,
 * e retomar todos devolve o atendimento automático a todo número que tiver agente
 * publicado. A contagem do que aconteceu volta na notificação — inclusive quantos
 * ficaram pausados por não terem versão publicada.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
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
import { agentsListQueryKey } from "@/hooks/ai/useAgents";
import { pauseAllAgentsAction, unpauseAllAgentsAction } from "../_actions";

type Confirmacao = "pausar" | "retomar" | null;

export function PausaGeralDosAgentes({ algumNoAr, algumPausado }: { algumNoAr: boolean; algumPausado: boolean }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [confirmar, setConfirmar] = useState<Confirmacao>(null);
  const [isPending, startTransition] = useTransition();

  const executar = (qual: "pausar" | "retomar") => {
    startTransition(async () => {
      if (qual === "pausar") {
        const res = await pauseAllAgentsAction();
        if (!res.ok) {
          toast.error(res.message ?? t("Não foi possível pausar os agentes."));
        } else {
          toast.success(t("Agentes pausados: {n}.").replace("{n}", String(res.data?.pausados ?? 0)));
        }
      } else {
        const res = await unpauseAllAgentsAction();
        if (!res.ok) {
          toast.error(res.message ?? t("Não foi possível retomar os agentes."));
        } else {
          const retomados = res.data?.retomados ?? 0;
          const semVersao = res.data?.sem_versao_publicada ?? 0;
          const texto = t("Agentes retomados: {n}.").replace("{n}", String(retomados));
          toast.success(
            semVersao > 0
              ? `${texto} ${t("Sem versão publicada, continuam pausados: {n}.").replace("{n}", String(semVersao))}`
              : texto,
          );
        }
      }
      await qc.invalidateQueries({ queryKey: agentsListQueryKey });
      router.refresh();
      setConfirmar(null);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="pausa-geral-dos-agentes">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending || !algumNoAr}
        onClick={() => setConfirmar("pausar")}
        data-testid="pausar-todos-os-agentes"
      >
        <Pause size={14} aria-hidden className="mr-2" /> {t("Pausar todos")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={isPending || !algumPausado}
        onClick={() => setConfirmar("retomar")}
        data-testid="retomar-todos-os-agentes"
      >
        <Play size={14} aria-hidden className="mr-2" /> {t("Retomar todos")}
      </Button>

      <AlertDialog open={confirmar !== null} onOpenChange={(aberto) => !aberto && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmar === "pausar" ? t("Pausar todos os agentes?") : t("Retomar todos os agentes?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "pausar"
                ? t(
                    "Nenhum agente vai responder até ser retomado. Uma resposta que estiver sendo gerada agora não é enviada. As conversas continuam chegando normalmente para a equipe.",
                  )
                : t(
                    "Os agentes com versão publicada voltam a responder, só para mensagens que chegarem depois deste clique. Os que não têm versão publicada continuam pausados.",
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{t("Cancelar")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmar) executar(confirmar);
              }}
              data-testid="confirmar-pausa-geral"
            >
              {confirmar === "pausar" ? t("Pausar todos") : t("Retomar todos")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
