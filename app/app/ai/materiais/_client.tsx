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

export interface MaterialLinha {
  id: string;
  titulo: string;
  quando_enviar: string;
  tipo: "video" | "imagem" | "documento";
  mime: string;
  tamanho_bytes: number;
  agente_ids: string[];
  ativo: boolean;
  updated_at: string;
  /** URL assinada curta para a prévia; `null` se o arquivo não foi achado. */
  url: string | null;
}

interface Rascunho {
  id: string | null;
  titulo: string;
  quandoEnviar: string;
  agenteIds: string[];
  ativo: boolean;
  arquivo: File | null;
}

const LIMITE_EM_BYTES = 16 * 1024 * 1024;

const rascunhoVazio = (): Rascunho => ({
  id: null,
  titulo: "",
  quandoEnviar: "",
  agenteIds: [],
  ativo: true,
  arquivo: null,
});

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MateriaisClient({
  inicial,
  agentes,
  podeEditar,
}: {
  inicial: MaterialLinha[];
  agentes: Array<{ id: string; name: string }>;
  podeEditar: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [isPending, startTransition] = useTransition();

  const rotuloDoTipo: Record<MaterialLinha["tipo"], string> = {
    video: t("Vídeo"),
    imagem: t("Imagem"),
    documento: t("PDF"),
  };
  const nomeDoAgente = new Map(agentes.map((a) => [a.id, a.name]));

  const salvar = () => {
    if (!editando) return;
    const dados = {
      titulo: editando.titulo,
      quando_enviar: editando.quandoEnviar,
      agente_ids: editando.agenteIds,
      ativo: editando.ativo,
    };
    startTransition(async () => {
      try {
        if (editando.id === null) {
          if (editando.arquivo === null) {
            toast.error(t("Escolha o arquivo do material."));
            return;
          }
          if (editando.arquivo.size > LIMITE_EM_BYTES) {
            toast.error(t("O arquivo passa de 16 MB, o limite do WhatsApp para vídeo."));
            return;
          }
          const form = new FormData();
          form.append("arquivo", editando.arquivo);
          form.append("dados", JSON.stringify(dados));
          const res = await fetch("/api/v1/ai/materiais", { method: "POST", body: form });
          if (!res.ok) {
            const corpo = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
            throw new Error(corpo?.error?.message ?? t("Não foi possível salvar o material."));
          }
        } else {
          await apiClient.patch(`/api/v1/ai/materiais/${editando.id}`, dados);
        }
        toast.success(t("Material salvo."));
        setEditando(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Não foi possível salvar o material."));
      }
    });
  };

  const alternarAtivo = (m: MaterialLinha) => {
    startTransition(async () => {
      try {
        await apiClient.patch(`/api/v1/ai/materiais/${m.id}`, { ativo: !m.ativo });
        toast.success(m.ativo ? t("Material desativado.") : t("Material ativado."));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Não foi possível salvar o material."));
      }
    });
  };

  const remover = (m: MaterialLinha) => {
    if (!window.confirm(t("Remover este material? O arquivo sai do CRM; o que já foi enviado nas conversas continua lá."))) {
      return;
    }
    startTransition(async () => {
      try {
        await apiClient.delete(`/api/v1/ai/materiais/${m.id}`);
        toast.success(t("Material removido."));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Não foi possível remover o material."));
      }
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="materiais-do-agente">
      {podeEditar && editando === null ? (
        <div>
          <Button onClick={() => setEditando(rascunhoVazio())} data-testid="novo-material">
            {t("Novo material")}
          </Button>
        </div>
      ) : null}

      {editando !== null ? (
        <Card className="flex flex-col gap-3 p-4" data-testid="formulario-material">
          {editando.id === null ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="material-arquivo">{t("Arquivo")}</Label>
              <Input
                id="material-arquivo"
                type="file"
                accept="video/mp4,image/jpeg,image/png,application/pdf"
                onChange={(e) => setEditando({ ...editando, arquivo: e.target.files?.[0] ?? null })}
              />
              <p className="text-xs text-text-muted">
                {t("Vídeo MP4, imagem JPEG ou PNG, ou PDF, até 16 MB.")}
              </p>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="material-titulo">{t("Título")}</Label>
            <Input
              id="material-titulo"
              maxLength={120}
              value={editando.titulo}
              onChange={(e) => setEditando({ ...editando, titulo: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="material-quando">{t("Quando enviar")}</Label>
            <Textarea
              id="material-quando"
              maxLength={2000}
              rows={4}
              value={editando.quandoEnviar}
              onChange={(e) => setEditando({ ...editando, quandoEnviar: e.target.value })}
            />
            <p className="text-xs text-text-muted">
              {t(
                "Descreva a situação, como faria com uma pessoa da equipe. Exemplo: quando o lead demonstrar interesse em Informática Básica ou pedir para saber como é o curso.",
              )}
            </p>
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editando.ativo}
              onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })}
              data-testid="material-ativo"
            />
            {t("Ativo: os agentes podem enviar")}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={isPending} onClick={salvar} data-testid="salvar-material">
              {isPending ? t("Enviando…") : t("Salvar")}
            </Button>
            <Button variant="ghost" disabled={isPending} onClick={() => setEditando(null)}>
              {t("Cancelar")}
            </Button>
          </div>
        </Card>
      ) : null}

      {inicial.length === 0 ? (
        <p className="text-sm text-text-muted" data-testid="sem-materiais">
          {t("Nenhum material ainda. Sem material, os agentes respondem só com texto.")}
        </p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {inicial.map((m) => (
            <li key={m.id}>
              <Card className="flex flex-col gap-2 p-4" data-testid="material">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.titulo}</span>
                  <Badge variant="secondary">{rotuloDoTipo[m.tipo]}</Badge>
                  <Badge variant={m.ativo ? "default" : "secondary"} data-testid="situacao-do-material">
                    {m.ativo ? t("Ativo") : t("Desativado")}
                  </Badge>
                  <span className="text-xs text-text-muted">{megabytes(m.tamanho_bytes)}</span>
                </div>
                {m.url !== null && m.tipo === "video" ? (
                  <video src={m.url} controls preload="metadata" className="max-h-64 w-full rounded-md bg-black" />
                ) : null}
                {m.url !== null && m.tipo === "imagem" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt={m.titulo} className="max-h-64 w-full rounded-md object-contain" />
                ) : null}
                {m.url !== null && m.tipo === "documento" ? (
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-sm underline">
                    {t("Abrir o PDF")}
                  </a>
                ) : null}
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-text-muted">{t("Quando enviar")}</span>
                  <p className="whitespace-pre-wrap text-sm">{m.quando_enviar}</p>
                </div>
                <p className="text-xs text-text-muted">
                  {m.agente_ids.length === 0
                    ? t("Todos os agentes")
                    : m.agente_ids.map((id) => nomeDoAgente.get(id) ?? id).join(", ")}
                </p>
                {podeEditar ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        setEditando({
                          id: m.id,
                          titulo: m.titulo,
                          quandoEnviar: m.quando_enviar,
                          agenteIds: m.agente_ids,
                          ativo: m.ativo,
                          arquivo: null,
                        })
                      }
                    >
                      {t("Editar")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={isPending} onClick={() => alternarAtivo(m)}>
                      {m.ativo ? t("Desativar") : t("Ativar")}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={isPending} onClick={() => remover(m)}>
                      {t("Remover")}
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
