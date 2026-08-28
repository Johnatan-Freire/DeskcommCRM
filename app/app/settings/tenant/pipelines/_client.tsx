"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updatePipelineConfig } from "@/app/actions/settings/updatePipelineConfig";
import type { PipelineConfigPatch } from "@/lib/schemas/settings";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { customFieldSchema, type CustomFieldDef } from "@/lib/schemas/settings";
import { Plus, Trash } from "@/lib/ui/icons";
import { AgentMappingSection, ancoraDoMapeamento } from "./_mapping";
import { StagesSection, ancoraDasEtapas } from "./_stages";

export interface PipelineRow {
  id: string;
  name: string;
  slug: string;
  vocabulary: Record<string, string> | null;
  settings: Record<string, unknown> | null;
}

function readLostReasons(settings: Record<string, unknown> | null): string[] {
  if (!settings) return [];
  const r = (settings as { lost_reasons?: unknown }).lost_reasons;
  return Array.isArray(r) ? (r as string[]) : [];
}

export function PipelinesClient({
  pipelines,
  podeEditarConfig,
}: {
  pipelines: PipelineRow[];
  /** Vocabulário/custom fields são admin (a server action recusa o resto). */
  podeEditarConfig: boolean;
}) {
  if (pipelines.length === 0) {
    // A partir do commit 6d1351fe (03/08), criar funil é feito pela tela
    // "Funis" (/app/kanban, FunisClient), não mais só por script de instalação
    // — o texto antigo aqui datava de antes dessa feature e mandava o usuário
    // caçar um botão que não existia em lugar nenhum. Agora o caminho é real.
    return (
      <Card className="p-6 text-sm leading-relaxed text-muted-foreground">
        Você ainda não tem nenhum funil. Enquanto for assim, o agente atende normalmente, mas não
        tem para onde levar o card de ninguém — não há etapas para onde mover.{" "}
        <a href="/app/kanban" className="text-accent underline underline-offset-4">
          Crie um funil na tela Funis
        </a>{" "}
        — depois ele aparece aqui para você configurar vocabulário e campos.
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {pipelines.map((p) => (
        <Card key={p.id} className="space-y-6 p-6">
          <header>
            <h2 className="text-base font-semibold">{p.name}</h2>
            <p className="text-xs text-muted-foreground">/{p.slug}</p>
          </header>
          {/* As ETAPAS vêm primeiro, e a ordem é a do raciocínio de quem
              configura: primeiro o quadro existe do jeito da sua operação,
              depois se decide o que o assistente faz com ele. Invertido, a
              primeira coisa que o dono da clínica vê é um mapeamento sobre
              colunas de e-commerce que ele nem sabia que dava para trocar. */}
          <StagesSection pipelineId={p.id} ancoraMapeamento={ancoraDoMapeamento(p.id)} />
          <div className="border-t border-border pt-6">
            <AgentMappingSection pipelineId={p.id} ancoraEtapas={ancoraDasEtapas(p.id)} />
          </div>
          {podeEditarConfig && <PipelineEditor pipeline={p} />}
        </Card>
      ))}
    </div>
  );
}

function PipelineEditor({ pipeline }: { pipeline: PipelineRow }) {
  const v = pipeline.vocabulary ?? {};
  const [lead, setLead] = useState(v.lead ?? "Lead");
  const [deal, setDeal] = useState(v.deal ?? "Deal");
  const [won, setWon] = useState(v.won ?? "Ganho");
  const [lost, setLost] = useState(v.lost ?? "Perdido");
  const [reasonsText, setReasonsText] = useState(readLostReasons(pipeline.settings).join(", "));
  const [fields, setFields] = useState<CustomFieldDef[]>(camposDoFunil(pipeline.settings));
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const ok: CustomFieldDef[] = [];
    for (const f of fields) {
      const parsed = customFieldSchema.safeParse(f);
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Campo inválido.");
        return;
      }
      ok.push(parsed.data);
    }
    const reasons = reasonsText
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const patch: PipelineConfigPatch = {
      vocabulary: { lead, deal, won, lost },
      fields: ok,
      lost_reasons: reasons,
    };
    startTransition(async () => {
      const r = await updatePipelineConfig(pipeline.id, patch);
      if (r.ok) toast.success(`${pipeline.name} atualizado.`);
      else toast.error(`Erro: ${r.error}`);
    });
  }

  const TIPOS: CustomFieldDef["type"][] = [
    "text",
    "textarea",
    "number",
    "date",
    "boolean",
    "email",
    "phone",
    "url",
    "select",
  ];

  return (
    <div className="space-y-4 border-t border-border pt-6">
      <h3 className="text-sm font-semibold">Vocabulário e campos</h3>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Lead</Label>
          <Input value={lead} onChange={(e) => setLead(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Deal</Label>
          <Input value={deal} onChange={(e) => setDeal(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Won</Label>
          <Input value={won} onChange={(e) => setWon(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Lost</Label>
          <Input value={lost} onChange={(e) => setLost(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Motivos de perda (separados por vírgula)</Label>
        <Input value={reasonsText} onChange={(e) => setReasonsText(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Campos do lead neste funil</Label>
        <p className="text-xs text-muted-foreground">
          Aparecem no dossiê do negócio. No follow-up, você escolhe em qual campo gravar a resposta.
        </p>
        {fields.map((f, i) => (
          <div key={`${f.key}-${i}`} className="grid gap-2 rounded-md border border-border p-2 md:grid-cols-[1fr_1fr_8rem_auto]">
            <Input
              aria-label={`Chave do campo ${i + 1}`}
              placeholder="chave (endereco)"
              value={f.key}
              onChange={(e) => {
                const next = [...fields];
                next[i] = { ...f, key: e.target.value };
                setFields(next);
              }}
            />
            <Input
              aria-label={`Rótulo do campo ${i + 1}`}
              placeholder="Rótulo (Endereço)"
              value={f.label}
              onChange={(e) => {
                const next = [...fields];
                next[i] = { ...f, label: e.target.value };
                setFields(next);
              }}
            />
            <Select
              value={f.type}
              onValueChange={(type) => {
                const next = [...fields];
                next[i] = { ...f, type: type as CustomFieldDef["type"] };
                setFields(next);
              }}
            >
              <SelectTrigger aria-label={`Tipo do campo ${i + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remover campo ${f.label || i + 1}`}
              onClick={() => setFields(fields.filter((_, j) => j !== i))}
            >
              <Trash size={14} aria-hidden />
            </Button>
            {f.type === "select" && (
              <Input
                className="md:col-span-3"
                aria-label={`Opções do campo ${i + 1}`}
                placeholder="Opções, separadas por vírgula"
                value={(f.options ?? []).map((o) => o.label).join(", ")}
                onChange={(e) => {
                  const options = e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((label) => ({ value: label, label }));
                  const next = [...fields];
                  next[i] = { ...f, options };
                  setFields(next);
                }}
              />
            )}
          </div>
        ))}
        {fields.length < 50 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setFields([
                ...fields,
                { key: `campo_${fields.length + 1}`, label: "Novo campo", type: "text" },
              ])
            }
          >
            <Plus size={14} aria-hidden className="mr-1" /> Adicionar campo
          </Button>
        )}
      </div>

      <div className="flex sm:justify-end">
        <Button onClick={handleSave} disabled={isPending} className="w-full sm:w-auto">
          {isPending ? "Salvando…" : "Salvar vocabulário e campos"}
        </Button>
      </div>
    </div>
  );
}
