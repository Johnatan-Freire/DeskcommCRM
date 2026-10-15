"use client";

/**
 * Feriados do atendimento humano (migration 0660). Um dia aqui = a equipe inteira
 * fora: a IA continua atendendo, o handoff deixa de prometer consultor naquele dia
 * e a estimativa de "a equipe volta às…" pula o feriado.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";

interface Feriado {
  id: string;
  data: string;
  descricao: string;
}

function formatarDia(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function FeriadosDoAtendimento({ canManage, feriados }: { canManage: boolean; feriados: Feriado[] }) {
  const t = useT();
  const router = useRouter();
  const [data, setData] = useState("");
  const [descricao, setDescricao] = useState("");
  const [isPending, startTransition] = useTransition();
  const anoAtual = new Date().getFullYear();

  const executar = (acao: () => Promise<unknown>, sucesso: string) => {
    startTransition(async () => {
      try {
        await acao();
        toast.success(sucesso);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Não foi possível salvar."));
      }
    });
  };

  return (
    <Card className="mt-6 flex flex-col gap-3 p-4" data-testid="feriados-do-atendimento">
      <div>
        <h2 className="text-base font-semibold">{t("Feriados do atendimento")}</h2>
        <p className="text-sm text-text-muted">
          {t(
            "Nesses dias a equipe inteira está fora: a IA continua atendendo, mas não promete um consultor e informa quando a equipe volta.",
          )}
        </p>
        <p className="text-xs text-text-muted">
          {t(
            "Os feriados nacionais não incluem feriados do estado, do Distrito Federal ou da cidade (no DF, por exemplo, o Dia do Evangélico em 30/11): cadastre esses dias um a um.",
          )}
        </p>
      </div>

      {feriados.length === 0 ? (
        <p className="text-sm text-text-muted" data-testid="sem-feriados">
          {t("Nenhum feriado cadastrado.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {feriados.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-sm" data-testid="feriado">
              <span>
                {formatarDia(f.data)} — {f.descricao}
              </span>
              {canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() =>
                    executar(() => apiClient.delete(`/api/v1/attendants/feriados/${f.id}`), t("Feriado removido."))
                  }
                >
                  {t("Remover")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1">
              <Label htmlFor="feriado-data">{t("Dia")}</Label>
              <Input id="feriado-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="feriado-descricao">{t("Descrição")}</Label>
              <Input
                id="feriado-descricao"
                maxLength={120}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder={t("Ex.: Aniversário da cidade")}
              />
            </div>
            <Button
              disabled={isPending || data === "" || descricao.trim() === ""}
              onClick={() =>
                executar(async () => {
                  await apiClient.post("/api/v1/attendants/feriados", { data, descricao: descricao.trim() });
                  setData("");
                  setDescricao("");
                }, t("Feriado cadastrado."))
              }
              data-testid="adicionar-feriado"
            >
              {t("Adicionar")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {[anoAtual, anoAtual + 1].map((ano) => (
              <Button
                key={`pf-${ano}`}
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() =>
                  executar(
                    () => apiClient.post("/api/v1/attendants/feriados", { pontos_facultativos: ano }),
                    t("Pontos facultativos de {ano} cadastrados.").replace("{ano}", String(ano)),
                  )
                }
                data-testid={`pontos-facultativos-${ano}`}
              >
                {t("Adicionar Carnaval e Corpus Christi de {ano}").replace("{ano}", String(ano))}
              </Button>
            ))}
            {[anoAtual, anoAtual + 1].map((ano) => (
              <Button
                key={ano}
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  executar(
                    () => apiClient.post("/api/v1/attendants/feriados", { nacionais: ano }),
                    t("Feriados nacionais de {ano} cadastrados.").replace("{ano}", String(ano)),
                  )
                }
                data-testid={`feriados-nacionais-${ano}`}
              >
                {t("Adicionar feriados nacionais de {ano}").replace("{ano}", String(ano))}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
