/**
 * O calendário que a tela Equipe › Atendimento oferece para importar, COM NOME e
 * COM TIPO — porque o que vale para o prazo da LGPD (`lib/lgpd/holidays-br.ts`,
 * que conta Carnaval e Corpus Christi como dia não útil) não é o que vale para o
 * expediente de uma escola: Carnaval e Corpus Christi são PONTOS FACULTATIVOS
 * federais, não feriados nacionais por lei. Importar tudo como "Feriado nacional"
 * faria o sistema dizer que a equipe está fora num dia em que a escola abre.
 *
 * Fora daqui de propósito: feriados estaduais, distritais e municipais (cada
 * escola tem os seus — no DF, por exemplo, o Dia do Evangélico em 30/11 é
 * feriado distrital) e a Quarta-feira de Cinzas (ponto facultativo até as 14h,
 * que não cabe num dia inteiro). Esses se cadastram um a um na tela.
 */
import { diaEmTornoDaPascoa } from "@/lib/lgpd/pascoa";
import { PRIMEIRO_ANO_DA_CONSCIENCIA_NEGRA } from "@/lib/lgpd/holidays-br";

export type TipoDoDia = "feriado_nacional" | "ponto_facultativo";

export interface DiaDoCalendario {
  data: string;
  descricao: string;
  tipo: TipoDoDia;
}

export function feriadosNacionaisDoAno(ano: number): DiaDoCalendario[] {
  const dias: DiaDoCalendario[] = [
    { data: `${ano}-01-01`, descricao: "Confraternização Universal", tipo: "feriado_nacional" },
    { data: diaEmTornoDaPascoa(ano, -2), descricao: "Sexta-feira Santa", tipo: "feriado_nacional" },
    { data: `${ano}-04-21`, descricao: "Tiradentes", tipo: "feriado_nacional" },
    { data: `${ano}-05-01`, descricao: "Dia do Trabalho", tipo: "feriado_nacional" },
    { data: `${ano}-09-07`, descricao: "Independência do Brasil", tipo: "feriado_nacional" },
    { data: `${ano}-10-12`, descricao: "Nossa Senhora Aparecida", tipo: "feriado_nacional" },
    { data: `${ano}-11-02`, descricao: "Finados", tipo: "feriado_nacional" },
    { data: `${ano}-11-15`, descricao: "Proclamação da República", tipo: "feriado_nacional" },
    { data: `${ano}-12-25`, descricao: "Natal", tipo: "feriado_nacional" },
  ];
  if (ano >= PRIMEIRO_ANO_DA_CONSCIENCIA_NEGRA) {
    dias.push({ data: `${ano}-11-20`, descricao: "Dia Nacional de Zumbi e da Consciência Negra", tipo: "feriado_nacional" });
  }
  return dias.sort((a, b) => a.data.localeCompare(b.data));
}

export function pontosFacultativosDoAno(ano: number): DiaDoCalendario[] {
  return [
    { data: diaEmTornoDaPascoa(ano, -48), descricao: "Carnaval (segunda-feira)", tipo: "ponto_facultativo" as const },
    { data: diaEmTornoDaPascoa(ano, -47), descricao: "Carnaval (terça-feira)", tipo: "ponto_facultativo" as const },
    { data: diaEmTornoDaPascoa(ano, 60), descricao: "Corpus Christi", tipo: "ponto_facultativo" as const },
  ].sort((a, b) => a.data.localeCompare(b.data));
}
