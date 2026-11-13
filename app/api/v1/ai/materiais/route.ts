import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * Materiais do agente (migration 8006): vídeos, imagens e PDFs que os agentes
 * de IA enviam na conversa, com a situação em que cada um vai.
 *
 * GET  (agent+): os materiais da organização, do mais recente ao mais antigo.
 * POST (manager+): multipart com `arquivo` (MP4, JPEG, PNG ou PDF, até 16 MB,
 *      formato decidido pelos BYTES) e `dados` (JSON com título, "quando enviar",
 *      agentes e ativo). O arquivo vai para o bucket privado `agent-materials`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { lerCorpoComTeto } from "@/lib/api/corpo-com-teto";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BUCKET_DOS_MATERIAIS,
  caminhoDoMaterial,
  COLUNAS_DO_MATERIAL,
  criarMaterialSchema,
  farejarFormato,
  TAMANHO_MAXIMO_DO_MATERIAL,
} from "@/lib/ai/materiais-do-agente";
import { agentesSaoDaOrganizacao } from "@/lib/ai/materiais-do-agente-servidor";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "materiais_do_agente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { data, error } = await createAdminClient()
    .from("materiais_do_agente")
    .select(COLUNAS_DO_MATERIAL)
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return fail("internal_error", t("Erro ao carregar os materiais."), 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "materiais_do_agente" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  // O corpo nunca passa do teto, nem sem Content-Length. 1 MB de folga para o
  // multipart; o teto de verdade é o tamanho do arquivo, conferido abaixo.
  const corpo = await lerCorpoComTeto(req, TAMANHO_MAXIMO_DO_MATERIAL + 1_048_576, {
    requestId,
    idioma: authz.user.idioma,
    acimaDoTeto: t("O arquivo passa de 16 MB, o limite do WhatsApp para vídeo."),
  });
  if (!corpo.ok) return corpo.response;
  const form = await corpo.corpo.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!(arquivo instanceof File)) {
    return fail("validation_failed", t("Escolha o arquivo do material."), 422, { requestId });
  }
  if (arquivo.size === 0 || arquivo.size > TAMANHO_MAXIMO_DO_MATERIAL) {
    return fail("validation_failed", t("O arquivo passa de 16 MB, o limite do WhatsApp para vídeo."), 422, {
      requestId,
    });
  }

  let dadosBrutos: unknown = null;
  try {
    dadosBrutos = JSON.parse(String(form?.get("dados") ?? "null"));
  } catch {
    dadosBrutos = null;
  }
  const parsed = criarMaterialSchema.safeParse(dadosBrutos);
  if (!parsed.success) {
    return fail("validation_failed", t("Material inválido."), 422, { requestId, details: parsed.error.flatten() });
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const formato = farejarFormato(bytes);
  if (formato === null) {
    return fail(
      "validation_failed",
      t("Formato não aceito. Envie um vídeo MP4, uma imagem JPEG ou PNG, ou um PDF."),
      422,
      { requestId },
    );
  }

  const admin = createAdminClient();
  if (!(await agentesSaoDaOrganizacao(admin, orgId, parsed.data.agente_ids))) {
    return fail("validation_failed", t("Algum agente escolhido não é desta organização."), 422, { requestId });
  }

  const id = randomUUID();
  const storagePath = caminhoDoMaterial(orgId, id, formato.ext);
  const { error: upErr } = await admin.storage
    .from(BUCKET_DOS_MATERIAIS)
    .upload(storagePath, bytes, { contentType: formato.mime, upsert: false });
  if (upErr) return fail("internal_error", t("Erro ao guardar o arquivo."), 500, { requestId });

  const { data, error } = await admin
    .from("materiais_do_agente")
    .insert({
      id,
      organization_id: orgId,
      ...parsed.data,
      tipo: formato.tipo,
      mime: formato.mime,
      tamanho_bytes: bytes.byteLength,
      storage_path: storagePath,
      created_by: authz.user.id,
      updated_by: authz.user.id,
    })
    .select(COLUNAS_DO_MATERIAL)
    .single();
  if (error || !data) {
    // Sem a linha, o arquivo não tem dono: sai do bucket.
    await admin.storage.from(BUCKET_DOS_MATERIAIS).remove([storagePath]);
    return fail("internal_error", t("Erro ao salvar o material."), 500, { requestId });
  }

  void audit({
    action: "ai.material_do_agente_criado",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "materiais_do_agente",
    resourceId: id,
    requestId,
    metadata: { tipo: formato.tipo, tamanho_bytes: bytes.byteLength, agentes: parsed.data.agente_ids.length },
  });
  return ok(data, { requestId });
}
