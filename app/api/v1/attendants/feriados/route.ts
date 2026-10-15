import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * Feriados do atendimento humano (migration 0660).
 *
 * GET  (agent+): os feriados de 30 dias atrás até um ano à frente.
 * POST (manager+): `{ data, descricao }` cadastra um dia; `{ nacionais: ano }`
 *      cadastra os feriados nacionais do ano (os que já existem ficam como estão).
 *
 * Feriado = a equipe inteira fora naquele dia: o handoff deixa de prometer
 * consultor e a estimativa de reabertura pula o dia. A IA segue atendendo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { PRIMEIRO_ANO_COBERTO, ULTIMO_ANO_COBERTO } from "@/lib/lgpd/holidays-br";
import { feriadosNacionaisDoAno, pontosFacultativosDoAno } from "@/lib/escalacao/feriados-do-ano";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const umDiaSchema = z
  .object({
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    descricao: z.string().trim().min(1).max(120),
  })
  .strict()
  .refine((d) => !Number.isNaN(new Date(`${d.data}T12:00:00Z`).getTime()), { path: ["data"], message: "Data inválida." });
const ano = z.number().int().min(PRIMEIRO_ANO_COBERTO).max(ULTIMO_ANO_COBERTO);
// `nacionais`: só os feriados nacionais POR LEI. `pontos_facultativos`: Carnaval e
// Corpus Christi, que a escola importa só se fecha nesses dias.
const nacionaisSchema = z.union([
  z.object({ nacionais: ano }).strict(),
  z.object({ pontos_facultativos: ano }).strict(),
]);

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "feriados_de_atendimento" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const hoje = Date.now();
  const { data, error } = await createAdminClient()
    .from("feriados_de_atendimento")
    .select("id, data, descricao")
    .eq("organization_id", authz.org.orgId)
    .gte("data", new Date(hoje - 30 * 86_400_000).toISOString().slice(0, 10))
    .lte("data", new Date(hoje + 366 * 86_400_000).toISOString().slice(0, 10))
    .order("data");
  if (error) return fail("internal_error", t("Erro ao carregar os feriados."), 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "feriados_de_atendimento" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const corpo = await req.json().catch(() => null);
  const nacionais = nacionaisSchema.safeParse(corpo);
  const umDia = nacionais.success ? null : umDiaSchema.safeParse(corpo);
  if (!nacionais.success && !umDia?.success) {
    return fail("validation_failed", t("Feriado inválido."), 422, { requestId });
  }
  const doCalendario = nacionais.success
    ? "nacionais" in nacionais.data
      ? feriadosNacionaisDoAno(nacionais.data.nacionais)
      : pontosFacultativosDoAno(nacionais.data.pontos_facultativos)
    : null;
  const linhas = doCalendario
    ? doCalendario.map((d) => ({
        organization_id: authz.org.orgId,
        data: d.data,
        descricao: d.descricao,
        created_by: authz.user.id,
      }))
    : [{ organization_id: authz.org.orgId, data: umDia!.data!.data, descricao: umDia!.data!.descricao, created_by: authz.user.id }];

  const { data, error } = await createAdminClient()
    .from("feriados_de_atendimento")
    .upsert(linhas, { onConflict: "organization_id,data", ignoreDuplicates: true })
    .select("id, data, descricao");
  if (error) return fail("internal_error", t("Erro ao salvar o feriado."), 500, { requestId });

  void audit({
    action: "atendimento.feriado_cadastrado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "feriados_de_atendimento",
    resourceId: null,
    requestId,
    metadata: { dias: linhas.map((l) => l.data), importacao: nacionais.success ? nacionais.data : null },
  });
  return ok(data ?? [], { requestId });
}
