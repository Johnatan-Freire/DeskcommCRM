import { resolveField } from "@/lib/automation/conditions";

const ALIASES: Record<string, string> = {
  nome: "contact.name",
  primeiro_nome: "contact.name",
  telefone: "contact.phone_number",
  email: "contact.email",
};

/**
 * `{{servico}}` como atalho de `{{lead.custom_fields.servico}}`.
 *
 * Quem escreve a mensagem digita o nome do campo que o formulário mandou, e não
 * o caminho interno do banco. Só vale para nome SIMPLES (sem ponto) e só como
 * ÚLTIMO recurso: alias e caminho direto continuam ganhando, então nenhum
 * template que já funcionava muda de resultado. Lista (multiselect) sai
 * separada por vírgula, que é como a pessoa leria.
 */
function campoPersonalizadoDoLead(context: Record<string, unknown>, nome: string): unknown {
  // Alias é marcação do CRM e tem dono: contato sem nome fica vazio, não pega
  // um campo do formulário que por acaso se chame igual.
  if (nome.includes(".") || ALIASES[nome] !== undefined) return undefined;
  const lead = context.lead;
  if (!lead || typeof lead !== "object") return undefined;
  const campos = (lead as { custom_fields?: unknown }).custom_fields;
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) return undefined;
  // Só campo PRÓPRIO: `{{constructor}}` ou `{{toString}}` não podem puxar do protótipo.
  if (!Object.hasOwn(campos, nome)) return undefined;
  const valor = (campos as Record<string, unknown>)[nome];
  return Array.isArray(valor) ? valor.join(", ") : valor;
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const resolved =
      resolveField(context, ALIASES[path] ?? path) ?? campoPersonalizadoDoLead(context, path);
    // `{{primeiro_nome}}` = primeira palavra do nome, como no Inbox e na campanha.
    const texto = String(resolved ?? "");
    return path === "primeiro_nome" ? (texto.trim().split(/\s+/)[0] ?? "") : texto;
  });
}
