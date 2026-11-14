import { describe, expect, it } from "vitest";

import {
  caminhoDoMaterial,
  criarMaterialSchema,
  editarMaterialSchema,
  farejarFormato,
  MATERIAIS_INDISPONIVEIS,
  renderMateriaisDoAgente,
  tipoDeMensagemDoMime,
} from "./materiais-do-agente";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);

describe("farejarFormato — o formato vem dos BYTES, não do nome", () => {
  it("MP4 pela caixa ftyp", () => {
    expect(farejarFormato(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d))).toEqual({
      tipo: "video",
      mime: "video/mp4",
      ext: "mp4",
    });
  });
  it("JPEG, PNG e PDF", () => {
    expect(farejarFormato(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe("image/jpeg");
    expect(farejarFormato(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe("image/png");
    expect(farejarFormato(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))?.tipo).toBe("documento");
  });
  it("o resto é recusado: texto, executável, vídeo de outro contêiner, arquivo vazio", () => {
    expect(farejarFormato(new TextEncoder().encode("<html>vídeo.mp4</html>"))).toBeNull();
    expect(farejarFormato(bytes(0x4d, 0x5a))).toBeNull(); // MZ (exe)
    expect(farejarFormato(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBeNull(); // WebM/MKV
    expect(farejarFormato(new Uint8Array())).toBeNull();
  });
});

describe("tipoDeMensagemDoMime — o tipo da mensagem do canal", () => {
  it("vídeo sai como vídeo, imagem como imagem, PDF como documento", () => {
    expect(tipoDeMensagemDoMime("video/mp4")).toBe("video");
    expect(tipoDeMensagemDoMime("image/png")).toBe("image");
    expect(tipoDeMensagemDoMime("application/pdf")).toBe("document");
  });
});

describe("validação do cadastro", () => {
  it("apara os textos e aplica os padrões (todos os agentes, ativo)", () => {
    const r = criarMaterialSchema.parse({
      titulo: "  Vídeo Informática Básica ",
      quando_enviar: "  quando o lead perguntar como é o curso  ",
    });
    expect(r).toEqual({
      titulo: "Vídeo Informática Básica",
      quando_enviar: "quando o lead perguntar como é o curso",
      agente_ids: [],
      ativo: true,
    });
  });
  it("recusa 'quando enviar' curto demais, campo desconhecido e edição vazia", () => {
    expect(criarMaterialSchema.safeParse({ titulo: "x", quando_enviar: "sempre" }).success).toBe(false);
    expect(
      criarMaterialSchema.safeParse({ titulo: "x", quando_enviar: "quando pedir o vídeo", storage_path: "a" }).success,
    ).toBe(false);
    expect(editarMaterialSchema.safeParse({}).success).toBe(false);
  });
  it("o caminho no bucket é <org>/<id>.<ext>, o mesmo que o CHECK da tabela exige", () => {
    expect(caminhoDoMaterial("org-1", "mat-1", "mp4")).toBe("org-1/mat-1.mp4");
  });
});

describe("renderMateriaisDoAgente — o bloco que o agente lê", () => {
  it("sem material, bloco nenhum (o modelo não aprende a usar o que não existe)", () => {
    expect(renderMateriaisDoAgente([])).toBe("");
  });
  it("cada material numa linha, com id, tipo, título e a instrução da equipe", () => {
    const bloco = renderMateriaisDoAgente([
      {
        id: "11111111-1111-4111-8111-111111111111",
        titulo: "Apresentação Informática",
        quando_enviar: "quando o lead\nquiser saber\n\ncomo é o curso",
        tipo: "video",
      },
    ]);
    expect(bloco).toContain("MATERIAIS PARA ENVIAR");
    expect(bloco).toContain(
      '- material_id 11111111-1111-4111-8111-111111111111 · vídeo · "Apresentação Informática" — enviar quando: quando o lead quiser saber como é o curso',
    );
    expect(bloco).toContain("send_message");
    expect(bloco).toContain("responda a pergunta dele também");
  });
  it("leitura que falha fecha: o modelo não promete material", () => {
    expect(MATERIAIS_INDISPONIVEIS).toContain("Não prometa enviar");
  });
});
