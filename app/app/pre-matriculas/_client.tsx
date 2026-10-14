"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import type { StatusDaPreMatricula } from "@/lib/pre-matricula/registrar";

export interface PreMatriculaLinha {
  id: string;
  conversation_id: string | null;
  nome_completo: string;
  email: string;
  telefone: string;
  curso: string;
  turno: "manha" | "tarde" | "noite" | "sem_preferencia";
  status: StatusDaPreMatricula;
  observacao: string | null;
  consentimento_em: string;
  created_at: string;
}

export function PreMatriculasClient({ inicial, todas }: { inicial: PreMatriculaLinha[]; todas: boolean }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notas, setNotas] = useState<Record<string, string>>({});

  const turno: Record<PreMatriculaLinha["turno"], string> = {
    manha: t("Manhã"),
    tarde: t("Tarde"),
    noite: t("Noite"),
    sem_preferencia: t("Sem preferência"),
  };
  const status: Record<StatusDaPreMatricula, string> = {
    nova: t("Nova"),
    em_atendimento: t("Em atendimento"),
    matriculado: t("Matriculado"),
    desistiu: t("Desistiu"),
  };

  const alterar = (id: string, corpo: { status?: StatusDaPreMatricula; observacao?: string | null }) => {
    startTransition(async () => {
      try {
        await apiClient.patch(`/api/v1/pre-matriculas/${id}`, corpo);
        toast.success(t("Pré-matrícula atualizada."));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("Não foi possível atualizar."));
      }
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="pre-matriculas">
      <div className="flex gap-2 text-sm">
        <Link href="/app/pre-matriculas" className={todas ? "text-text-muted underline" : "font-medium"}>
          {t("Abertas")}
        </Link>
        <span className="text-text-muted">·</span>
        <Link href="/app/pre-matriculas?status=todas" className={todas ? "font-medium" : "text-text-muted underline"}>
          {t("Todas")}
        </Link>
      </div>

      {inicial.length === 0 ? (
        <p className="text-sm text-text-muted" data-testid="sem-pre-matriculas">
          {todas ? t("Nenhuma pré-matrícula registrada ainda.") : t("Nenhuma pré-matrícula esperando atendimento.")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inicial.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-2 p-4" data-testid="pre-matricula">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.nome_completo}</span>
                  <Badge variant={p.status === "nova" ? "default" : "secondary"}>{status[p.status]}</Badge>
                  <span className="text-xs text-text-muted">{new Date(p.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm">
                  {p.curso} · {turno[p.turno]}
                </p>
                <p className="text-xs text-text-muted">
                  {p.email} · {p.telefone}
                </p>
                <Textarea
                  rows={2}
                  maxLength={2000}
                  placeholder={t("Anotação da equipe (opcional)")}
                  value={notas[p.id] ?? p.observacao ?? ""}
                  onChange={(e) => setNotas({ ...notas, [p.id]: e.target.value })}
                />
                <div className="flex flex-wrap gap-2">
                  {p.conversation_id ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/app/inbox?id=${p.conversation_id}`}>{t("Abrir conversa")}</Link>
                    </Button>
                  ) : null}
                  {p.status === "nova" ? (
                    <Button size="sm" disabled={isPending} onClick={() => alterar(p.id, { status: "em_atendimento" })}>
                      {t("Assumir")}
                    </Button>
                  ) : null}
                  {p.status === "nova" || p.status === "em_atendimento" ? (
                    <>
                      <Button size="sm" variant="outline" disabled={isPending} onClick={() => alterar(p.id, { status: "matriculado" })}>
                        {t("Matriculado")}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={isPending} onClick={() => alterar(p.id, { status: "desistiu" })}>
                        {t("Desistiu")}
                      </Button>
                    </>
                  ) : null}
                  {notas[p.id] !== undefined && notas[p.id] !== (p.observacao ?? "") ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      onClick={() => alterar(p.id, { observacao: notas[p.id]?.trim() ? notas[p.id]!.trim() : null })}
                    >
                      {t("Salvar anotação")}
                    </Button>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
