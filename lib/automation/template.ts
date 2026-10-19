import { resolveField } from "@/lib/automation/conditions";
import { nomeDoContato, type ContatoNomeavel } from "@/lib/contacts/rotulo-do-contato";

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

/**
 * Campos do contato que SÓ A EQUIPE vê e que nenhuma mensagem renderiza, nem
 * pedidos pelo caminho (`{{contact.address_book_name}}`). O contexto da
 * automação carrega a linha inteira do contato (`select("*")`), então a guarda
 * mora aqui, onde todo texto de automação e de modelo de mensagem passa. O nome
 * da agenda é o rótulo que alguém da empresa escreveu no celular e pode ser um
 * apelido interno (decisão do mantenedor no PR #2439).
 */
const SO_DA_EQUIPE = new Set(["contact.address_book_name"]);

export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    if (SO_DA_EQUIPE.has(path)) return "";
    // `{{nome}}` fala com a pessoa: segue a régua única de nome de gente
    // (cadastrado, depois o perfil do WhatsApp). Contato que chega pelo
    // WhatsApp tem `name` nulo — só `contact.name` saía "Olá , ...".
    const resolved =
      path === "nome" || path === "primeiro_nome"
        ? nomeDoContato(context.contact as ContatoNomeavel | undefined)
        : (resolveField(context, ALIASES[path] ?? path) ?? campoPersonalizadoDoLead(context, path));
    // `{{primeiro_nome}}` = primeira palavra do nome, como no Inbox e na campanha.
    const texto = String(resolved ?? "");
    return path === "primeiro_nome" ? (texto.trim().split(/\s+/)[0] ?? "") : texto;
  });
}
