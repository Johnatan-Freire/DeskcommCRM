/**
 * Gestão da configuração de `org_sistema_escolar_config` PELA TELA — leitura
 * mascarada e escrita cifrada. Distinto de `carregarConfig` (sistema-escolar.ts),
 * que decifra a chave pra USO INTERNO da tool do agente: aqui a chave em claro
 * nunca atravessa a fronteira HTTP de volta pro browser, nem na leitura nem na
 * escrita — só `api_key_last4` (mesmo padrão de `ai_provider_credentials`).
 *
 * A tabela nasceu com `revoke select ... from authenticated, anon` (migration
 * 0399) porque não havia tela ainda — nenhum caminho de browser precisava ler
 * as colunas cifradas. Esta é a primeira leitura, e ela usa SEMPRE o admin
 * client no servidor (nunca PostgREST direto do browser), filtrando
 * `organization_id` manualmente a partir do cookie/JWT resolvido por
 * `requireRole` — nunca do body.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { encryptKey, decryptKey, bufToBytea, byteaToBuffer } from "@/lib/crypto/aes_gcm";
import { chamar, type ConfigSistemaEscolar } from "./sistema-escolar";

export interface ConfigSeguraSistemaEscolar {
  configurado: boolean;
  base_url: string | null;
  api_key_last4: string | null;
  is_active: boolean;
  updated_at: string | null;
}

interface RowSegura {
  base_url: string;
  api_key_last4: string;
  is_active: boolean;
  updated_at: string;
}

/** Nunca seleciona `api_key_encrypted/iv/tag` — só o que a tela pode mostrar. */
const COLUNAS_SEGURAS = "base_url, api_key_last4, is_active, updated_at";

export async function lerConfigSegura(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ConfigSeguraSistemaEscolar> {
  const { data } = await admin
    .from("org_sistema_escolar_config")
    .select(COLUNAS_SEGURAS)
    .eq("organization_id", organizationId)
    .maybeSingle<RowSegura>();

  if (!data) {
    return { configurado: false, base_url: null, api_key_last4: null, is_active: false, updated_at: null };
  }
  return {
    configurado: true,
    base_url: data.base_url,
    api_key_last4: data.api_key_last4,
    is_active: data.is_active,
    updated_at: data.updated_at,
  };
}

export type SalvarConfigResultado =
  | { ok: true }
  | { ok: false; motivo: "sem_chave_na_criacao" };

/**
 * Upsert por `organization_id` (chave primária — uma linha por org).
 *
 * `apiKey` é OPCIONAL na atualização: campo vazio na tela significa "não
 * mexi na chave", não "apagar a chave". Só falta na CRIAÇÃO, quando não há
 * chave anterior pra manter.
 */
export async function salvarConfig(
  admin: SupabaseClient,
  organizationId: string,
  userId: string,
  input: { baseUrl: string; apiKey?: string; isActive: boolean },
): Promise<SalvarConfigResultado> {
  const { data: existente } = await admin
    .from("org_sistema_escolar_config")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle<{ organization_id: string }>();

  if (!existente && !input.apiKey) {
    return { ok: false, motivo: "sem_chave_na_criacao" };
  }

  const linha: Record<string, unknown> = {
    organization_id: organizationId,
    base_url: input.baseUrl,
    is_active: input.isActive,
  };
  if (!existente) linha.created_by = userId;

  if (input.apiKey) {
    const cifrada = encryptKey(input.apiKey);
    linha.api_key_encrypted = bufToBytea(cifrada.ciphertext);
    linha.api_key_iv = bufToBytea(cifrada.iv);
    linha.api_key_tag = bufToBytea(cifrada.tag);
    linha.api_key_last4 = cifrada.last4;
  }

  const { error } = await admin.from("org_sistema_escolar_config").upsert(linha, {
    onConflict: "organization_id",
  });
  if (error) throw new Error(`falha ao gravar org_sistema_escolar_config: ${error.message}`);
  return { ok: true };
}

export async function removerConfig(admin: SupabaseClient, organizationId: string): Promise<void> {
  const { error } = await admin
    .from("org_sistema_escolar_config")
    .delete()
    .eq("organization_id", organizationId);
  if (error) throw new Error(`falha ao remover org_sistema_escolar_config: ${error.message}`);
}

interface RowCompleta {
  base_url: string;
  api_key_encrypted: unknown;
  api_key_iv: unknown;
  api_key_tag: unknown;
}

/**
 * A ÚNICA função deste módulo que decifra — usada exclusivamente pra testar a
 * conexão logo depois de salvar (fecha o laço de retorno). A chave em claro
 * some do escopo quando a função retorna; nunca é devolvida ao chamador.
 */
async function carregarParaTeste(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ConfigSistemaEscolar | null> {
  const { data } = await admin
    .from("org_sistema_escolar_config")
    .select("base_url, api_key_encrypted, api_key_iv, api_key_tag")
    .eq("organization_id", organizationId)
    .maybeSingle<RowCompleta>();
  if (!data) return null;

  const apiKey = decryptKey({
    ciphertext: byteaToBuffer(data.api_key_encrypted),
    iv: byteaToBuffer(data.api_key_iv),
    tag: byteaToBuffer(data.api_key_tag),
  });
  return { baseUrl: data.base_url, apiKey };
}

export type TesteDeConexaoResultado = { ok: true } | { ok: false; erro: string };

/**
 * Fecha o laço de retorno (invariante 7 do Sistema Vivo): sem isto, uma
 * URL/chave errada só aparece quando um aluno pergunta algo e a tool falha —
 * minutos ou dias depois de salva, sem ninguém olhando. `/api/deskcomm/cursos`
 * serve de ping por ser o único endpoint que não depende de um telefone real.
 *
 * Decifra e testa NO MESMO escopo — a chave em claro nunca sai desta função.
 */
export async function testarConexao(
  admin: SupabaseClient,
  organizationId: string,
): Promise<TesteDeConexaoResultado> {
  const config = await carregarParaTeste(admin, organizationId);
  if (!config) return { ok: false, erro: "configuração não encontrada" };
  try {
    await chamar(config, "/api/deskcomm/cursos");
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : String(err) };
  }
}
