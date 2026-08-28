/**
 * Reencontra o cadastro pelas grafias do mesmo número (nono dígito BR).
 * Sem isto, captação e WhatsApp viram dois contatos e o follow-up não vê a resposta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { phoneLookupVariants } from "./phone-variants";

export async function encontrarContatoPorTelefone(
  admin: SupabaseClient,
  orgId: string,
  rawPhone: string,
): Promise<{ id: string; phone_number: string } | null> {
  const variantes = phoneLookupVariants(rawPhone);
  if (variantes.length === 0) return null;
  const { data } = await admin
    .from("contacts")
    .select("id, phone_number")
    .eq("organization_id", orgId)
    .in("phone_number", variantes)
    .is("is_merged_into", null)
    .limit(1)
    .maybeSingle();
  return (data as { id: string; phone_number: string } | null) ?? null;
}

/** O contato da mensagem e os gêmeos gravados com a outra grafia do número. */
export async function idsDoContatoEGemeos(
  admin: SupabaseClient,
  orgId: string,
  contactId: string,
): Promise<string[]> {
  const ids = new Set<string>([contactId]);
  const { data: me } = await admin
    .from("contacts")
    .select("phone_number")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  const phone = typeof me?.phone_number === "string" ? me.phone_number : null;
  if (!phone) return [...ids];
  const variantes = phoneLookupVariants(phone);
  if (variantes.length === 0) return [...ids];
  const { data: gemeos } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .in("phone_number", variantes)
    .is("is_merged_into", null);
  for (const row of gemeos ?? []) {
    if (typeof row.id === "string") ids.add(row.id);
  }
  return [...ids];
}
