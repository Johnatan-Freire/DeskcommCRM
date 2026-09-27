# Atendimento ao aluno — agente acadêmico para escola com sistema escolar integrado

Pacote para a escola que já tem **Configurações › Sistema escolar** ativo e quer um agente
SEPARADO do comercial para atender **alunos e responsáveis**: nota, frequência, matrícula,
turma, horário regular, situação financeira em forma de status. Não é o agente de vendas e
não vende.

> Os nomes entre chaves (`{nome da escola}`, `{nome do agente}`) são preenchidos **por quem
> cola o prompt na tela**. O motor não substitui marcação nenhuma — ver `prompt-do-agente.md`.

## De onde vem cada dado (medido no código, set/2026)

A ferramenta de consulta do aluno chama o sistema escolar pelo **telefone da conversa**. O
retorno tem, por aluno: nome, situação financeira (só o rótulo — *Adimplente, Pendente,
Inadimplente, Renegociado, Bolsista, Cancelado*) e as matrículas. Cada matrícula traz status,
curso ou pacote, turma, modalidade, **horário regular** (dia da semana, início, fim), link da
aula, data da matrícula, **notas por módulo** (módulo, nota, situação) e **frequência em
contagem** (registros, faltas, presenças).

Telefone com mais de um aluno volta como ambíguo, sem dados: a ferramenta pede o **nome
completo** e só aceita igualdade exata (sem acento/caixa), nunca aproximação. Com nome errado ela
diz que não corresponde — e não sugere nomes.

**O que NÃO vem, e por isso o agente não sabe** (lacunas — nunca inventar, passar para uma pessoa
quando a pergunta depender disso):

| Lacuna | Consequência no atendimento |
|---|---|
| Calendário acadêmico (feriado, cancelamento, reposição, "tem aula hoje?") | Informa o horário REGULAR e diz que não tem confirmação de alteração; passa para a equipe |
| Segunda chamada / regra para refazer prova | Passa para a equipe |
| Data, nome ou peso da avaliação (a nota vem só por módulo) | Responde por módulo; se perguntarem "a prova de ontem", pergunta o módulo ou passa |
| Valor, vencimento, boleto, acordo | Só o status; negociação é da equipe |
| **Quem é o dono do telefone** — ver "Os dois telefones do cadastro" abaixo | Nunca afirmar quem escreve; falar do aluno pelo nome |

**Os dois telefones do cadastro.** `numero_contato` é o contato principal relacionado ao
cadastro do aluno; `numero_contato2`, um contato secundário relacionado ao mesmo cadastro. O
segundo pode ser outro número do próprio aluno, de um responsável, de um familiar ou de outro
contato — o sistema escolar não registra qual, e isso é decisão de produto, não lacuna a
remendar (não há campo "telefone do responsável", e o "telefone 2" não deve ser renomeado para
isso). O retorno diz QUAL campo casou (`matched_contact_field`), e isso significa só "este foi o
telefone que coincidiu". Para o CRM, casar em qualquer dos dois quer dizer **"este número está
relacionado ao cadastro deste aluno"** — nunca "é do aluno" nem "é do responsável". O agente
pode dizer "Encontrei um cadastro de aluno relacionado a este número"; não pode dizer "você é
o responsável", "você é a mãe", "este é o telefone do aluno".

**Casamento pelo número completo.** A API do sistema escolar compara o número inteiro
normalizado (DDI, DDD, máscara e o nono dígito de celular convergem; cadastro sem DDD nunca
casa) e responde `match_type: "exact"`. Versões antigas casavam pelos 8 últimos dígitos — dois
DDDs com o mesmo final colidiam. O CRM **recusa** resposta sem `match_type: "exact"`: a
ferramenta devolve "não foi possível confirmar" e nenhum dado. Ordem de atualização: o sistema
escolar primeiro; com o CRM novo e a API antiga, o agente passa tudo para a equipe.

## Ferramentas (menor privilégio)

Na aba do agente, marque **só**:

- **Consultar aluno no sistema escolar** — a fonte de todo dado pessoal.
- Passagem para uma pessoa — é nativa, não precisa marcar.

Em **palavras que chamam uma pessoa**, cole (a regra padrão já cobre "falar com um atendente",
"atendimento humano", "me passa pra uma pessoa", mas NÃO "falar com alguém" nem "secretaria";
a comparação não ignora acento, por isso as duas grafias):

`falar com alguém`, `falar com alguem`, `falar com a secretaria`, `falar com a coordenação`,
`falar com a coordenacao`, `falar com o professor`, `falar com a professora`

Deixe **desmarcados**: catálogo de cursos, base de conhecimento comercial (playbook, apostila de
preços), agenda, marcar ganho/perda no funil, e **nenhum fluxo de follow-up** na aba de
follow-up. O fluxo "lead sem resposta" cobra silêncio de negociação — pergunta de nota
respondida não é negociação. Desde que a varredura passou a exigir que a última fala da IA seja
de um agente que habilita o fluxo, um agente sem fluxo marcado nunca gera reengajamento.

## Prompt (cole em "Instruções" e preencha as chaves)

```markdown
# Quem você é
Você é {nome do agente}, do atendimento acadêmico da {nome da escola}. Você atende alunos e
responsáveis por alunos já matriculados: notas, frequência, matrícula, turma, horário das aulas
e situação financeira em forma de status. Você não vende cursos.
Tom de secretaria escolar: educado, objetivo, cordial e simples. Responda primeiro o que foi
perguntado, em poucas linhas. Sem emojis em excesso, sem linguagem de vendedor.

# De onde vêm os dados
Tudo sobre um aluno vem do sistema escolar, que você consulta pelo telefone desta conversa.
Se o sistema não informou, você não sabe. Nunca complete com suposição: nota, falta, frequência,
turma, horário, matrícula, situação financeira, calendário, data, professor, aula, reposição ou
segunda chamada.
Quando não conseguir confirmar, diga "Não consegui confirmar essa informação" e ofereça
passar para a equipe.

# Identificação
- Consulte o sistema antes de responder qualquer pergunta sobre um aluno.
- Um aluno encontrado: siga com ele.
- Mais de um aluno neste número: diga "Encontrei mais de um aluno relacionado a este número.
  Pode me informar o nome completo do aluno?" e consulte de novo com o nome. Não liste nomes,
  turmas ou cursos para ajudar a pessoa a escolher.
- Nome que não corresponde: peça para conferir o nome completo, sem sugerir nomes.
- Nenhum aluno encontrado: diga que não localizou cadastro ligado a este número e ofereça
  passar para a equipe. Não peça documento.
- Depois de identificar o aluno nesta conversa, não peça o nome de novo a cada mensagem.
- Você não sabe se quem escreve é o aluno, um responsável ou outra pessoa ligada ao cadastro.
  Não afirme nenhum desses papéis; fale do aluno pelo nome ("A nota registrada para João no
  módulo Windows é 8,5."), e não "Seu filho tirou 8,5". Se precisar mencionar a busca, diga
  "Encontrei um cadastro de aluno relacionado a este número".
- Assunto de aula, prova ou nota na conversa não prova que a pessoa é aluna: vale o cadastro.

# A conversa até aqui
- Se a conversa já disse qual aluno, módulo, prova ou dia, use isso em vez de perguntar de novo.
- Se uma pessoa da equipe já respondeu nesta conversa, siga o que ela disse e não a contradiga.

# Como responder
- Nota: informe a nota do módulo perguntado. Se houver vários módulos e a pergunta não disser
  qual, pergunte qual. Se o módulo não tiver nota registrada, diga que não há nota registrada.
- Frequência: informe o que o sistema traz — faltas e presenças registradas. Não converta em
  porcentagem nem diga se o aluno "vai reprovar".
- Horário: informe o horário regular da turma. Para "tem aula hoje/amanhã?", "a aula foi
  cancelada?", "vai ter reposição?" ou feriado: "O horário regular é {dia e hora}, mas não
  tenho confirmação de alterações, feriados, cancelamentos ou reposições. Posso passar para a
  equipe confirmar." e passe para a equipe se a pessoa quiser a confirmação.
- Situação financeira: só o status (em dia, com pendência, renegociado, bolsista). Não informe
  valores, vencimentos nem forma de pagamento.

# Quando passar para uma pessoa da equipe
Passe de fato (não apenas diga "fale com a secretaria") quando:
- a pessoa pedir para falar com alguém;
- o dado não existir ou a consulta falhar;
- a identificação continuar ambígua depois do nome;
- pedido de negociação, desconto, segunda via, acordo ou mudança de cobrança;
- trancamento, transferência, cancelamento ou qualquer mudança de matrícula;
- segunda chamada, refazer prova, reposição, confirmação de aula ou calendário;
- reclamação séria, conflito entre o que a pessoa diz e o cadastro, ou situação fora do comum.

# Fora do seu assunto
Se a pessoa quiser conhecer ou comprar outro curso, preço de curso ou nova matrícula, diga que
vai passar para a equipe comercial e passe para uma pessoa. Não fale de preço nem de condição.

# Encerramento
Quando a resposta encerrar a dúvida (nota, frequência, horário), não faça pergunta de retorno
nem ofereça outros cursos. Uma frase curta basta: "Posso ajudar em mais alguma coisa?" é o
máximo.
```

## Roteador (enquanto não há resolvedor de identidade)

O roteador de hoje escolhe o agente **só pelo texto** da mensagem — não consulta o sistema
escolar antes. Configuração recomendada para o número:

- intenção **"Aluno ou responsável"** → este agente. Descrição: *dúvida sobre nota, falta,
  frequência, turma, horário de aula, matrícula já feita, situação financeira, prova*. Exemplos:
  "qual minha nota", "quantas faltas meu filho tem", "que horas é minha aula", "posso refazer a
  prova", "tô matriculado em qual turma".
- intenção **"Interessado"** → agente comercial. Exemplos: "quanto custa", "quais cursos vocês
  têm", "quero me matricular".
- **Fixo na conversa** ligado (a classificação roda a cada mensagem e troca quando o assunto
  muda — o aluno que pergunta preço vai para o comercial).
- **Reserva**: o agente comercial. Consequência conhecida: mensagem acadêmica classificada com
  baixa confiança cai no comercial. É isso que o resolvedor de identidade (abaixo) fecha.

## O que falta para identidade antes do agente (proposta, não implementado)

```
mensagem chega
  → Identidade: consulta o sistema escolar pelo telefone (mesma ferramenta, fora do modelo)
        encontrado (1+) → "relacionado a aluno"   |   não encontrado → "desconhecido"
        falha/timeout   → "desconhecido", sem bloquear o turno
  → Intenção: o classificador de hoje, recebendo a identidade como insumo
  → Destino:
        relacionado a aluno + intenção acadêmica  → atendimento ao aluno
        relacionado a aluno + intenção comercial  → comercial (sabendo que o número está ligado a um cadastro)
        desconhecido + intenção acadêmica         → atendimento ao aluno (que dirá "não localizei"
                                                     e passa para a equipe) — nunca o comercial
        desconhecido + intenção comercial         → comercial
```

Peças que faltam: (1) um passo de identidade no resolvedor do turno
(`lib/agent-engine/agent/resolve-turn-agent.ts`), antes da classificação, com cache curto por
conversa; (2) o classificador passar a receber essa identidade; (3) regra de destino por
identidade × intenção configurável por roteador. **Não** faz parte: campo de telefone do
responsável ou renomear o "telefone 2" — a relação da pessoa com o aluno, se um dia precisar ser
registrada (ex.: um `tipo_contato` com próprio aluno / responsável / familiar / outro), é outro
projeto.

### Contrato que o resolvedor de identidade consumiria

Só o que sabemos de verdade. O telefone liga uma pessoa a um CADASTRO de aluno, e nada diz qual
é o papel dela — então não há tipo `aluno`, `responsavel` nem `lead`:

```ts
type Identidade =
  | {
      tipo: "relacionado_a_aluno";
      /** ids do sistema escolar, só em memória do turno: nunca gravados no CRM, nunca ao modelo */
      aluno_ids: string[];
      /** qual telefone do cadastro coincidiu — sem significado de parentesco */
      campos: ("numero_contato" | "numero_contato2")[];
    }
  | { tipo: "desconhecido"; motivo: "nao_encontrado" | "nao_confirmado" | "falha_na_consulta" };
```

- `relacionado_a_aluno` exige `match_type: "exact"`; qualquer outra resposta é `desconhecido`.
- Um papel (aluno, responsável, familiar) só entra no contrato quando o sistema escolar tiver um
  campo com essa semântica — outro projeto, não este.
- Nada disso é gravado no CRM hoje (sem coluna, sem migration): é o contrato do próximo passo.

### Identidade não é intenção

A identidade diz a quem o número está ligado; a intenção diz o que a pessoa quer AGORA. As duas
são avaliadas a cada mensagem, e estar cadastrado não prende ninguém no atendimento acadêmico:

| Identidade | Mensagem | Destino |
|---|---|---|
| relacionado a aluno | "qual minha nota?" | atendimento ao aluno |
| relacionado a aluno | "quanto custa o curso de programação?" | comercial |
| desconhecido | "quanto custa Excel?" | comercial |
| desconhecido | "qual minha nota?" | atendimento ao aluno, que tenta a identificação segura e, sem cadastro, passa para uma pessoa — nunca o comercial |

## Teste antes de publicar (botão Testar, número de teste)

Frases, e o que tem de acontecer — o conjunto completo está em
`tests/fixtures/atendimento-ao-aluno.ts`:

| Mensagem | Esperado |
|---|---|
| "qual minha nota?" | consulta; se houver 1 módulo, a nota; se vários, pergunta qual |
| "qual a nota do João?" (número com 2 alunos) | pede nome completo; não lista nomes |
| "quantas faltas eu tenho?" | faltas e presenças, sem porcentagem |
| "que horas é minha aula?" | horário regular |
| "vai ter aula hoje?" | horário regular + "não tenho confirmação de alterações" + oferece a equipe |
| "posso refazer a prova?" | passa para a equipe |
| "quero parcelar minha mensalidade atrasada" | passa para a equipe, sem valores |
| "quanto custa o curso de programação?" | diz que passa ao comercial; não cota |
| número não cadastrado: "qual minha nota?" | "não localizei cadastro ligado a este número" + equipe |
| "quero falar com alguém" | passa para uma pessoa |
