"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";

export interface AvisoLinha {
  id: string;
  titulo: string;
  descricao: string;
  inicio_em: string;
  fim_em: string;
  status: "rascunho" | "publicado" | "arquivado";
  publico: "leads" | "alunos" | "todos";
  agente_ids: string[];
  cursos: string[];
  prioridade: number;
  updated_at: string;
}

type Situacao = "vigente" | "agendado" | "vencido" | "rascunho" | "arquivado";

/** O que o agente enxerga AGORA — a mesma régua de `fn_avisos_vigentes`. */
export function situacaoDoAviso(a: Pick<AvisoLinha, "status" | "inicio_em" | "fim_em">, agora: Date): Situacao {
  if (a.status === "arquivado") return "arquivado";
  if (a.status === "rascunho") return "rascunho";
  if (agora < new Date(a.inicio_em)) return "agendado";
  if (agora >= new Date(a.fim_em)) return "vencido";
  return "vigente";
}

/** `datetime-local` (hora do navegador) ⇄ ISO. */
function paraCampo(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function doCampo(valor: string): string {
  return new Date(valor).toISOString();
}

interface Rascunho {
  id: string | null;
  titulo: string;
  descricao: string;
  inicio: string;
  fim: string;
  publico: AvisoLinha["publico"];
  agenteIds: string[];
  cursos: string;
  prioridade: number;
}

function rascunhoVazio(): Rascunho {
  const agora = new Date();
  const em7 = new Date(agora.getTime() + 7 * 24 * 3600_000);
  return {
    id: null,
    titulo: "",
    descricao: "",
    inicio: paraCampo(agora.toISOString()),
    fim: paraCampo(em7.toISOString()),
    publico: "todos",
    agenteIds: [],
    cursos: "",
    prioridade: 0,
  };
}

export function AvisosClient({
  inicial,
  agentes,
  podeEditar,
}: {
  inicial: AvisoLinha[];
  agentes: Array<{ id: string; name: string }>;
  podeEditar: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [isPending, startTransition] = useTransition();
  const agora = new Date();

  const rotulo: Record<Situacao, string> = {
    vigente: t("No ar"),
    agendado: t("Agendado"),
    vencido: t("Vencido"),
    rascunho: t("Rascunho"),
    arquivado: t("Arquivado"),
  };
  const rotuloPublico: Record<AvisoLinha["publico"], string> = {
    todos: t("Leads e alunos"),
    leads: t("Só leads"),
    alunos: t("Só alunos"),
  };

  const salvar = (publicar: boolean) => {
    if (!editando) return;
    const corpo = {
      titulo: editando.titulo,
      descricao: editando.descricao,
      inicio_em: doCampo(editando.inicio),
      fim_em: doCampo(editando.fim),
      publico: editando.publico,
      agente_ids: editando.agenteIds,
      cursos: editando.cursos
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
      prioridade: editando.prioridade,
      ...(publicar ? { status: "publicado" as const } : editando.id === null ? { status: "rascunho" as const } : {}),
    };
    startTransition(async () => {
      try {
        if (editando.id === null) await apiClient.post("/api/v1/ai/avisos", corpo);
        else await apiClient.patch(`/api/v1/ai/avisos/${editando.id}`, corpo);
        toast.success(publicar ? t("Aviso publicado.") : t("Aviso salvo."));
        setEditando(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Não foi possível salvar o aviso."));
      }
    });
  };

  const mudarStatus = (id: string, status: AvisoLinha["status"]) => {
    startTransition(async () => {
      try {
        await apiClient.patch(`/api/v1/ai/avisos/${id}`, { status });
        toast.success(status === "arquivado" ? t("Aviso arquivado.") : t("Aviso publicado."));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Não foi possível mudar o aviso."));
      }
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="avisos-temporarios">
      {podeEditar && editando === null ? (
        <div>
          <Button onClick={() => setEditando(rascunhoVazio())} data-testid="novo-aviso">
            {t("Novo aviso")}
          </Button>
        </div>
      ) : null}

      {editando !== null ? (
        <Card className="flex flex-col gap-3 p-4" data-testid="formulario-aviso">
          <div className="flex flex-col gap-1">
            <Label htmlFor="aviso-titulo">{t("Título")}</Label>
            <Input
              id="aviso-titulo"
              maxLength={120}
              value={editando.titulo}
              onChange={(e) => setEditando({ ...editando, titulo: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="aviso-descricao">{t("O que o agente pode dizer")}</Label>
            <Textarea
              id="aviso-descricao"
              maxLength={2000}
              rows={4}
              value={editando.descricao}
              onChange={(e) => setEditando({ ...editando, descricao: e.target.value })}
            />
            <p className="text-xs text-text-muted">
              {t("Escreva exatamente a condição: o agente não promete nada além deste texto.")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="aviso-inicio">{t("Começa em")}</Label>
              <Input
                id="aviso-inicio"
                type="datetime-local"
                value={editando.inicio}
                onChange={(e) => setEditando({ ...editando, inicio: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="aviso-fim">{t("Termina em")}</Label>
              <Input
                id="aviso-fim"
                type="datetime-local"
                value={editando.fim}
                onChange={(e) => setEditando({ ...editando, fim: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="aviso-publico">{t("Para quem")}</Label>
              <select
                id="aviso-publico"
                className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                value={editando.publico}
                onChange={(e) => setEditando({ ...editando, publico: e.target.value as AvisoLinha["publico"] })}
              >
                <option value="todos">{rotuloPublico.todos}</option>
                <option value="leads">{rotuloPublico.leads}</option>
                <option value="alunos">{rotuloPublico.alunos}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="aviso-prioridade">{t("Prioridade (0 a 100)")}</Label>
              <Input
                id="aviso-prioridade"
                type="number"
                min={0}
                max={100}
                value={editando.prioridade}
                onChange={(e) => setEditando({ ...editando, prioridade: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="aviso-cursos">{t("Cursos relacionados (separados por vírgula)")}</Label>
            <Input
              id="aviso-cursos"
              value={editando.cursos}
              onChange={(e) => setEditando({ ...editando, cursos: e.target.value })}
            />
          </div>
          {agentes.length > 0 ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium">{t("Agentes que podem usar (nenhum marcado = todos)")}</legend>
              {agentes.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editando.agenteIds.includes(a.id)}
                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        agenteIds: e.target.checked
                          ? [...editando.agenteIds, a.id]
                          : editando.agenteIds.filter((x) => x !== a.id),
                      })
                    }
                  />
                  {a.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={isPending} onClick={() => salvar(true)} data-testid="publicar-aviso">
              {t("Salvar e publicar")}
            </Button>
            <Button variant="outline" disabled={isPending} onClick={() => salvar(false)} data-testid="salvar-aviso">
              {t("Salvar sem publicar")}
            </Button>
            <Button variant="ghost" disabled={isPending} onClick={() => setEditando(null)}>
              {t("Cancelar")}
            </Button>
          </div>
        </Card>
      ) : null}

      {inicial.length === 0 ? (
        <p className="text-sm text-text-muted" data-testid="sem-avisos">
          {t("Nenhum aviso ainda. Sem aviso, os agentes não oferecem promoção nem condição especial.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inicial.map((a) => {
            const situacao = situacaoDoAviso(a, agora);
            return (
              <li key={a.id}>
                <Card className="flex flex-col gap-2 p-4" data-testid="aviso">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.titulo}</span>
                    <Badge variant={situacao === "vigente" ? "default" : "secondary"} data-testid="situacao-do-aviso">
                      {rotulo[situacao]}
                    </Badge>
                    <span className="text-xs text-text-muted">{rotuloPublico[a.publico]}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{a.descricao}</p>
                  <p className="text-xs text-text-muted">
                    {new Date(a.inicio_em).toLocaleString()} → {new Date(a.fim_em).toLocaleString()}
                    {a.cursos.length > 0 ? ` · ${a.cursos.join(", ")}` : ""}
                  </p>
                  {podeEditar && a.status !== "arquivado" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          setEditando({
                            id: a.id,
                            titulo: a.titulo,
                            descricao: a.descricao,
                            inicio: paraCampo(a.inicio_em),
                            fim: paraCampo(a.fim_em),
                            publico: a.publico,
                            agenteIds: a.agente_ids,
                            cursos: a.cursos.join(", "),
                            prioridade: a.prioridade,
                          })
                        }
                      >
                        {t("Editar")}
                      </Button>
                      {a.status === "rascunho" ? (
                        <Button size="sm" disabled={isPending} onClick={() => mudarStatus(a.id, "publicado")}>
                          {t("Publicar")}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => mudarStatus(a.id, "arquivado")}
                        data-testid="arquivar-aviso"
                      >
                        {t("Arquivar")}
                      </Button>
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
