import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/products — o catálogo da organização ativa.
 * POST /api/v1/products — cadastra um produto.
 *
 * `fotos` (lista de URLs, até 5, na ordem da capa) é aceita no corpo: o
 * servidor BAIXA cada uma e guarda o arquivo, e a URL deixa de ser a fonte —
 * o mesmo caminho da planilha (`lib/catalogo/fotos-por-url.ts`). O campo não é
 * coluna: sai do corpo antes do insert e entra como caminhos do bucket.
 *
 * Escrita exige `manager`: preço de venda não se altera com papel de leitura, e
 * é o motivo de este catálogo não morar na tabela da Nuvemshop, cuja policy é
 * org-flat sem checagem de papel.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { guardarFotosPorUrl } from "@/lib/catalogo/fotos-por-url";
import { apagarDoBucket } from "@/lib/catalogo/fotos-no-bucket";
import { COLUNAS_DO_PRODUTO, produtoCreateSchema } from "@/lib/schemas/produtos";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "catalog_products" });
  if (!authz.ok) return authz.response;

  const busca = req.nextUrl.searchParams.get("busca")?.trim() ?? "";
  const supabase = await createClient();

  let q = supabase
    .from("catalog_products")
    .select(COLUNAS_DO_PRODUTO)
    .eq("organization_id", authz.org.orgId);

  // A busca da TELA é substring simples, de propósito: quem opera a loja digita
  // o nome como cadastrou. A busca por token (que tolera "ifone") é a do
  // AGENTE, em `lib/catalogo/busca.ts`, e ela responde a outra pergunta.
  if (busca !== "") q = q.or(`nome.ilike.%${busca}%,codigo.ilike.%${busca}%,marca.ilike.%${busca}%`);

  const { data, error } = await q
    .order("ativo", { ascending: false })
    .order("nome")
    .limit(500);

  if (error) return fail("internal_error", "Erro ao listar os produtos.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "catalog_products" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = produtoCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();
  // A moeda vem da organização, nunca do corpo — ver `moedaDaOrganizacao()`.
  const moeda = await moedaDaOrganizacao(supabase, authz.org.orgId);

  // `fotos` é URL de ENTRADA e NÃO é coluna: sai do corpo antes do insert, como
  // a moeda sai antes de qualquer decisão. Ver o comentário do campo em
  // `lib/schemas/produtos.ts`.
  const { fotos, ...campos } = parsed.data;
  const urls = fotos ?? [];

  /**
   * ─── A foto é baixada ANTES de o produto existir na tabela ────────────────
   *
   * O caminho no bucket é `<org>/<produto>/<uuid>.<ext>`, então o id precisa
   * existir antes do download — daí o `id` gerado aqui e enviado no insert.
   * É o mesmo desenho da planilha (`import/route.ts`, grupo `novo+foto`), e
   * pelo mesmo motivo: gravar primeiro e baixar depois produziria o pior
   * desfecho, um 201 para um produto que ENTROU sem a foto que quem chamou
   * pediu. Baixar antes faz a recusa ser inteira.
   *
   * O downloader é o MESMO da planilha (teto por item, assinatura dos bytes,
   * guarda anti-SSRF, limpeza do que já subiu quando uma falha): um segundo
   * baixador aqui divergiria do primeiro na primeira correção de segurança.
   */
  const produtoId = urls.length > 0 ? randomUUID() : undefined;
  let caminhos: string[] | undefined;
  if (produtoId) {
    const guardadas = await guardarFotosPorUrl({ orgId: authz.org.orgId, produtoId, urls, t });
    if (!guardadas.ok) {
      // 422 e não 500: o corpo é que está errado (link morto, arquivo que não é
      // foto, acima de 5 MB), e quem lê é quem integrou.
      return fail("validation_failed", guardadas.motivo, 422, {
        requestId,
        details: { fotos: [guardadas.motivo] },
      });
    }
    caminhos = guardadas.caminhos;
  }

  const { data, error } = await supabase
    .from("catalog_products")
    .insert({
      ...campos,
      ...(produtoId ? { id: produtoId } : {}),
      ...(caminhos ? { fotos: caminhos } : {}),
      moeda,
      organization_id: authz.org.orgId,
      origem: "manual",
    })
    .select(COLUNAS_DO_PRODUTO)
    .single();

  if (error) {
    // Os arquivos já subiram e a linha não existe: sem esta limpeza, um código
    // repetido deixaria fotos órfãs no bucket pagas por ninguém.
    if (produtoId && caminhos?.length) {
      await apagarDoBucket(authz.org.orgId, produtoId, caminhos, requestId);
    }
    // 23505 = já existe produto com este código nesta organização. A recusa
    // nomeia o campo porque quem lê é quem digitou.
    if (error.code === "23505") {
      return fail("conflict", t("Já existe um produto com esse código."), 409, { requestId });
    }
    return fail("internal_error", "Erro ao salvar o produto.", 500, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "catalog_product.created",
    resourceType: "catalog_products",
    resourceId: (data as unknown as { id: string }).id,
    requestId,
  });

  return ok(data, { requestId, status: 201 });
}
