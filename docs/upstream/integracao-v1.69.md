# Integração seletiva do upstream v1.48 → v1.69 (Capital Code CRM)

O upstream (`melgarafael/DeskcommCRM`) é **fonte de correções e recursos**, não o
estado desejado deste fork. Esta integração trouxe, PR a PR, o que corrige bugs,
segurança, LGPD, agentes, CRM, Inbox e deploy — e adaptou ou recusou o que
quebraria uma regra da Capital Code / Sistema Escolar. Regra do conflito: **a regra
do fork vence.**

- Base comum: `v1.47.0` (`ebb7d03e98`). Alvo: `v1.69.0` (`e8e2912178`).
- Fork antes da integração: `main` `67deddb2c5`. Volta exata: tag
  `checkpoint/pre-upstream-v1.69-20261001T064800Z` (publicada) e o bundle
  `pre-upstream-v1.69-20261001T064800Z.bundle` (SHA256
  `06292d79e61f52dc72b2dcf84acc35b8cb0e31e318707596ba77fe89876a11a5`).
- Método: `git cherry-pick -m 1 -x` de cada PR selecionado, em ordem; conflito
  resolvido arquivo por arquivo, sem escolher lado em massa. Cada commit portado
  cita o PR de origem (`-x`).

## O que precisou de adaptação para não quebrar o fork

| Onde | O que o upstream fazia | O que ficou |
|---|---|---|
| Migrations | Usou 0403/0404 (colidem com as nossas) e timestamps de 0425/0495 iguais aos nossos | Importadas como **0389** (lead só liga à própria empresa) e **0393** (inbox sem reavaliar RLS); 0425/0495 com +1 min no timestamp. As nossas não mudaram |
| Editar/apagar mensagem (#1626) | Saía para o WhatsApp **sem** passar pelo `OUTBOUND_MESSAGING` | Atrás da trava nas duas camadas (seam `getAdapter` e cliente WAHA); cerca estendida |
| Anonimização LGPD (0497) | Cascata redigia tabelas de módulos não portados — **toda anonimização quebraria** (`relation crm_proposals does not exist`) | Seções atrás de `to_regclass`/checagem de coluna; texto da nota interna sempre redigido; export entrega as notas internas |
| Guarda de mensagem superada × #1609 | — | A resposta da própria IA não "supera" a pergunta do cliente; quem decide é a régua do #1609 |
| Campos exigidos por etapa (#1688) | Régua de campos no handoff/espelho | Trava de saída (`exit_locked`) **antes** da régua; motivo de ganho opt-in (funil sem ganho intacto) |
| Janela de resposta (#1984) | Recusa janela invertida | Regra do fork: **cruza a meia-noite**, como a de disparo |
| Escrita do agente no negócio do contato (#1874) | Dependia de campo do #1583 | Contato do turno repassado ao catálogo de tools — a guarda dispara |
| Redação de PII (`scrubMessage`) | Melhorada no #1746 (Sentry 11) | Portadas só as funções puras: o candidato ao golden ia a disco com telefone |
| White-label (pt/en/es) | Ressalva de IA como transferência internacional, com o Jev | Ressalva sem o Jev — vale para nós (provedor de IA estrangeiro) |
| Quadro do funil (#1727/#1740) | Contêiner novo de rolagem | Contêiner novo **+** as setas de navegação do fork |

## Adiado (fica para decisão/porte dedicado)

- **Roteiros de atendimento** (#1573) e a cadeia que depende deles: "o silêncio não fala por
  cima do retorno combinado" (#1729) e **lembrete interno sem mensagem ao cliente** (#1683).
- Propostas comerciais (#1832), B2B (#1860), grupos na inbox (#1647), rascunho sugerido por
  integração (#1684…), provedor personalizado (#1651), golden em tabela (#1720), Sentry 11 /
  ESLint 10 / bump de dependências.

## Não se aplica

Jev (serviço pago externo), canais que não usamos (Meta oficial, intermediado, Graph, voz,
OAuth social), conversões de anúncio, honorários/faturamento, Requesty/OpenRouter, e o kit
genérico de instalação/`update.sh` (nosso deploy é `scripts/deploy-vps.sh`).

## Guarda permanente

`tests/unit/capital-code-golden-invariants.test.ts` (**CAPITAL_CODE_GOLDEN_INVARIANTS**) amarra
as 25 regras do fork ao teste que prova cada uma. Numa próxima sincronização, se uma prova for
apagada ou renomeada, esse gate fica vermelho dizendo qual regra ficou sem dono.

## Tabela completa (234 PRs funcionais; os 32 PRs de release do upstream ficam de fora)

| Release | PR | Feature/Fix | Classificação | Ação | Motivo |
|---|---|---|---|---|---|
| 1.48.0 | #1569 | perf(imagens): o ARG de versão vem depois das camadas caras | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1564 | fix(kit): a atualização instala a release publicada, nunca a maior tag | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.48.0 | #1581 | fix(auth): voltar do OAuth social não desloga e mostra o desfecho — de @saraivabr | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.48.0 | #1584 | A localização compartilhada pelo canal intermediado chega com o ponto no mapa | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.48.0 | #1567 | fix(agenda): erro de leitura dos tipos não é mais desenhado como lista vazia | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1585 | feat(kanban): botão "Levar para outro funil" no menu do card — de @nsbastosconsultoria | ADAPTAR | portado com adaptação | mover negócio entre funis/etapas pela tela — passa pela trava de saída (PT423) e precisa explicar a recusa |
| 1.48.0 | #1583 | O pedido confirmado grava no negócio, na moeda da organização | NAO_SE_APLICA | não portado | pedido de e-commerce grava no negócio (migration 0400 colide com a nossa) |
| 1.48.0 | #1603 | fix(quadro): consultas .in() do board em lotes — funil grande volta a abrir | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1601 | docs(specs): Specs 01 e 11 declaram o prefixo dsk_ do token, com o motivo (#1129) | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.48.0 | #1597 | fix(ia): o worker cai na chave da plataforma quando a conta não tem chave (#1181) | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1609 | fix(agente): a mesma mensagem do cliente não recebe duas respostas | PORTAR | portado | correção/melhoria compatível; conflito resolvido: imports |
| 1.48.0 | #1575 | feat(ia): o Jev entra no sistema — decisões rápidas, encontráveis e ligáveis pela tela | NAO_SE_APLICA | não portado | Jev (serviço externo da TypeSafe) — não habilitar, sem dependência paga |
| 1.48.0 | #1582 | feat(api): leads e agenda aceitam Bearer dsk_ além da sessão — de @nsbastosconsultoria | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1586 | fix(leads): o lead só se liga a contato e responsável da própria empresa, com guarda no banco | ADAPTAR | portado com adaptação | lead só liga a contato/responsável da própria empresa (segurança) — migration 0403 colide: renumerar |
| 1.48.0 | #1620 | ci(cercas): i18n e fragmentos de release entram no pnpm cercas | ADIAR | não portado | reorganização de CI do upstream (partes do e2e, cercas) — nosso CI tem forma própria |
| 1.48.0 | #1617 | fix(inbox): ancoragem na abertura da conversa é instantânea em vez de rolar suave (#1590) | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1599 | test(kit): a suíte do install.sh hermetiza as chaves de IA do ambiente | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1618 | fix(media): resolve binding visao_de_imagem antes de falhar por credencial padrao da org (#1591) | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1610 | fix(waha): mensagem que chega com o banco indisponível não se perde mais | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1605 | fix(agente): rascunho assistido não espera o checkpoint que ninguém lê | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1589 | fix(kit): o backup confere o dump antes de dizer que terminou | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1598 | feat(llm): OPENAI_REASONING_EFFORT regula o raciocínio das chamadas à OpenAI | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1604 | feat(contato): o caminho de volta do descadastro (override da regra W-02) | PORTAR | portado | correção/melhoria compatível; conflito: ação de audit; Jev fora |
| 1.48.0 | #1557 | fix(tests): cerca de escrita em organizations fecha pontos cegos de escopo e exports (#1246) | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1592 | feat(inbox): mostrar botão de ligação na conversa | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.48.0 | #1587 | feat(navegacao): catalogo visual organizado por categorias e cards no modal de ferramentas | PORTAR | portado | correção/melhoria compatível; conflito: UI; sem trecho do Jev |
| 1.48.0 | #1622 | fix(ia): aviso de teto aparece no pacote clicado, não fora da tela | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1623 | Lote 24/09: migrations 0404–0408 — de @webtecnica e @vitorlacerdadigital | ADAPTAR | portado com adaptação | lote de migrations 0404–0408 do upstream — 0404 colide com a nossa: renumerar; adaptado: 0404→0393, 0403 do #1586→0389 |
| 1.48.0 | #1627 | fix(inbox): o selo do automático não quebra a barra de ações — de @raphaelmartins | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1600 | test(e2e): a caixa S:N do streaming SSR ganha instrumento e porta — caixa órfã não passa em silêncio | PORTAR | portado | correção/melhoria compatível; conflito: lista de specs, sem Jev |
| 1.48.0 | #1573 | feat(fluxos): telas dos roteiros de atendimento (3/4) — de @vgamkt | ADIAR | não portado | roteiros de atendimento (feature grande, opcional, depende de 3 PRs) |
| 1.48.0 | #1624 | fix(navegação): manter contraste do texto na busca de telas | PORTAR | portado | correção/melhoria compatível |
| 1.48.0 | #1626 | feat(inbox): editar e apagar mensagens pelo menu do balão | ADAPTAR | portado com adaptação | editar/apagar mensagem enviada — é saída para o WhatsApp: tem de passar pelo OUTBOUND_MESSAGING; adaptado: kill switch em editar/apagar |
| 1.48.0 | #1594 | fix(atendimento): o turno espera a mídia da CONVERSA, não só a que disparou o evento | PORTAR | portado | correção/melhoria compatível; conflito: espera de mídia por conversa + nosso corte de ativação |
| 1.48.0 | #1629 | feat(inbox): gerar link para cada conversa selecionada | PORTAR | portado | correção/melhoria compatível |
| 1.49.0 | #1631 | feat(agente): ligar e desligar o agente pelo celular (#on/#off), opcional por agente — de @vgamkt | PORTAR | portado | correção/melhoria compatível; conflito: i18n |
| 1.49.0 | #1633 | feat(canais): respostas do app WhatsApp Business entram no canal oficial (coexistência) | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.49.0 | #1634 | feat(conhecimento): base só reindexa o que mudou, e consertos dos roteiros — de @vgamkt | PORTAR | portado | correção/melhoria compatível; conflito: lista de audit |
| 1.49.0 | #1635 | fix(automacao): {{primeiro_nome}} tambem e preenchido na integracao | PORTAR | portado | correção/melhoria compatível |
| 1.49.0 | #1636 | feat(preview): permitir consulta a dados externos no modo teste do agente | PORTAR | portado | correção/melhoria compatível |
| 1.49.0 | #1637 | fix(backup): o cron do backup usa a conexão do dono, como o kit | PORTAR | portado | correção/melhoria compatível |
| 1.49.0 | #1638 | feat(EPIC-13): provedor Requesty | NAO_SE_APLICA | não portado | provedor de IA que não usamos (Requesty, OpenRouter/Gemini no acervo) |
| 1.49.0 | #1640 | fix(kit): a atualização para com status 1 quando o schema não chega | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.49.0 | #1641 | ci(build): fontes versionadas no repo — o build para de depender do Google | PORTAR | portado | correção/melhoria compatível |
| 1.50.0 | #1649 | fix(EPIC-13): o Testar do agente consulta catálogo e acervo sem contato | PORTAR | portado | correção/melhoria compatível |
| 1.50.0 | #1650 | feat(contatos): data de nascimento na ficha do contato e proposta pelo agente | PORTAR | portado | correção/melhoria compatível |
| 1.50.0 | #1651 | Provedor personalizado compatível com OpenAI na tela de credenciais | ADIAR | não portado | provedor personalizado compatível com OpenAI — não necessário agora |
| 1.50.0 | #1656 | test(e2e): a grade mede card e bloco no mesmo quadro (flake -42px da agenda) | PORTAR | portado | correção/melhoria compatível |
| 1.50.0 | #1658 | fix(api-tokens): teto de tokens ativos por organização no banco, com mensagem clara na emissão (#1448) | PORTAR | portado | correção/melhoria compatível; conflito revisado: apêndice do baseline, só o bloco 0415 |
| 1.50.0 | #1659 | LGPD: os dois caminhos de anonimizar redigem na MESMA função, com invariante por catálogo (#1504) | PORTAR | portado | correção/melhoria compatível |
| 1.51.0 | #1663 | fix(inbox): manter abas visíveis em colunas estreitas | PORTAR | portado | correção/melhoria compatível |
| 1.51.0 | #1664 | Entrar com Google com provedor desligado fica no CRM e mostra a mensagem, em vez do JSON cru do GoTrue | PORTAR | portado | correção/melhoria compatível |
| 1.51.0 | #1665 | fix(auth): fecha o cadastro direto do GoTrue em so_convite e mantém o convite (#1653) | PORTAR | portado | correção/melhoria compatível |
| 1.51.0 | #1667 | fix(agent): modo assistido não pula mais as detecções de STOP/opt-out e de pedido de humano (#1648) | PORTAR | portado | correção/melhoria compatível; conflito: imports |
| 1.51.0 | #1666 | fix(email): corrija convites filtrados por identificação SMTP em Docker | PORTAR | portado | correção/melhoria compatível |
| 1.51.0 | #1670 | fix(agente): o controle Confidence threshold sai do editor — ele não controlava nada | PORTAR | portado | correção/melhoria compatível; conflito: tradução zh-CN |
| 1.51.0 | #1669 | fix(agenda): o tipo escolhido na grade sobrevive ao recarregamento da página | PORTAR | portado | correção/melhoria compatível |
| 1.51.0 | #1671 | marca: ajustar o logo no navegador antes de recusar por passar de 512 KB (#1655) | ADAPTAR | portado com adaptação | marca/ícone/nome — manter Capital Code CRM pelo banco |
| 1.51.0 | #1674 | fix(auth): a volta do Google entra pela ponte same-origin, não por 302 (#1646) | PORTAR | portado | correção/melhoria compatível; conflito: social-return fora — #1581 não portado |
| 1.51.0 | #1673 | feat(mcp): modelos de mensagem para integração — variáveis do integrador, só compartilhados, link direto | ADIAR | não portado | modelos de mensagem via MCP — integração não usada |
| 1.51.0 | #1675 | Cadastro: /admin/cadastro avisa quando a troca de modo ainda não chegou ao GoTrue (#1668) | PORTAR | portado | correção/melhoria compatível |
| 1.51.0 | #1678 | feat(messages): envio por token idempotente e em nome de um atendente (#1613) — de @webtecnica | ADAPTAR | portado com adaptação | envio por token idempotente — caminho de saída: preservar kill switch |
| 1.51.0 | #1677 | Envio fora da janela de 24h recusado na hora e falha de entrega visível a quem integra | ADIAR | não portado | janela de 24h do canal oficial — só canal oficial; mexe no envio |
| 1.51.0 | #1679 | fix(ia): o agente com o provedor personalizado publica pelo modelo que o endpoint devolveu | ADIAR | não portado | provedor personalizado compatível com OpenAI — não necessário agora |
| 1.51.0 | #1680 | fix(kit): a credencial do dono do banco sai do processo do `app` e do `worker` | ADAPTAR | portado com adaptação | credencial do dono do banco fora do app/worker — portar para o NOSSO compose/deploy |
| 1.52.0 | #1566 | feat(conversoes): acompanhe e reprocesse vendas no Meta e Google | NAO_SE_APLICA | não portado | conversões de anúncio (Meta/Google Ads) — fora da operação |
| 1.52.0 | #1690 | fix(i18n): textos faltantes em espanhol e fuso da organização no horário | PORTAR | portado | correção/melhoria compatível; conflito: imports — Sistema Escolar + fuso |
| 1.52.0 | #1691 | fix(i18n): erros da API sem anglicismos e com tuteo no espanhol | PORTAR | portado | correção/melhoria compatível; conflito: i18n, auto |
| 1.52.0 | #1684 | Rascunho sugerido por integração: aberto por link, enviado só com clique (#1611) | ADIAR | não portado | rascunho sugerido por integração (feature + dependentes) |
| 1.52.0 | #1689 | feat(instalador): pergunta o idioma da CLI, português ou español | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.52.0 | #1696 | feat(ia): Jev onda 2 — cada tarefa com seu estado, e o Jev observando manipulação e roteador | NAO_SE_APLICA | não portado | Jev (serviço externo da TypeSafe) — não habilitar, sem dependência paga |
| 1.52.0 | #1699 | fix(onboarding): o 400 do modelo de raciocínio é a prova de crédito passando | PORTAR | portado | correção/melhoria compatível |
| 1.52.0 | #1698 | test: guard the Atender cap arithmetic the e2e only catches after ~20 min (#1692) | PORTAR | portado | correção/melhoria compatível |
| 1.52.0 | #1701 | feat(central): avisos abertos saem por gravidade, e o crítico antigo não some | PORTAR | portado | correção/melhoria compatível |
| 1.52.0 | #1703 | fix(lgpd): o export do titular inclui o rascunho sugerido e as propostas de campo | ADIAR | não portado | rascunho sugerido por integração (feature + dependentes) |
| 1.52.0 | #1704 | feat(api): a criacao do rascunho sugerido aceita Idempotency-Key | ADIAR | não portado | rascunho sugerido por integração (feature + dependentes) |
| 1.52.0 | #1705 | fix(ia): preserva skills legadas | PORTAR | portado | correção/melhoria compatível |
| 1.52.0 | #1706 | test(e2e): goto/reload esperam o streaming SSR revelar a página (#1374) | PORTAR | portado | correção/melhoria compatível; conflito: specs de features não portadas ficam fora |
| 1.53.0 | #1688 | feat(lead): campos obrigatórios ao entrar em etapa/encerrar e motivo de ganho nativo (#1536) | ADAPTAR | portado com adaptação | campos exigidos por etapa, motivo de ganho/perda, previsão — não pode reintroduzir won obrigatório nem furar exit_locked; adaptado: trava antes da régua de campos; só bloco 0420 |
| 1.53.0 | #1708 | fix(agente): candidato a golden set não grava texto de cliente cru em disco | PORTAR | portado | correção/melhoria compatível |
| 1.53.0 | #1709 | Aviso de compromisso com horário, responsável e status, e gatilhos de comparecimento (#1612) | ADIAR | não portado | agenda por integração/webhook de compromisso — não usado |
| 1.53.0 | #1712 | feat(leads): retomada de negócio perdido como novo negócio por funil (#1538) | ADAPTAR | portado com adaptação | retomada de negócio perdido como novo negócio — precisa respeitar Desistiu terminal e Alunos travado |
| 1.53.0 | #1714 | fix(leads): mover para a etapa em que o negócio já está não passa pela régua de campos | ADAPTAR | portado com adaptação | campos exigidos por etapa, motivo de ganho/perda, previsão — não pode reintroduzir won obrigatório nem furar exit_locked |
| 1.53.0 | #1718 | #1694 — modelo de busca no seletor do atendente, provedor do agente novo, jargão no Publicar e 'já está de pé' | PORTAR | portado | correção/melhoria compatível |
| 1.53.0 | #1719 | Expurga rascunho sugerido por integração vencido — décima poda do data-retention (#1686) | ADIAR | não portado | rascunho sugerido por integração (feature + dependentes) |
| 1.53.0 | #1717 | Motivos de perda com categoria e previsão ponderada do funil (#1537, #1535) — de @webtecnica | ADAPTAR | portado com adaptação | campos exigidos por etapa, motivo de ganho/perda, previsão — não pode reintroduzir won obrigatório nem furar exit_locked; adaptado: etapa leva service_policy+exit_locked E win_probability |
| 1.53.0 | #1722 | fix(followup): o envio inline enxerga o job vencido no mesmo milissegundo | PORTAR | portado | correção/melhoria compatível; conflito: testes do follow-up, os dois lados |
| 1.53.0 | #1725 | fix(passagem): o aviso ao cliente e o título na Central saem no idioma da organização | PORTAR | portado | correção/melhoria compatível |
| 1.53.0 | #1730 | fix(agente): quando a conta de IA fica sem saldo, a resposta espera a recarga em vez de morrer | PORTAR | portado | correção/melhoria compatível |
| 1.53.0 | #1720 | LGPD: o candidato ao golden set sai do disco e vira linha de rótulo (golden_candidates, 0428) | ADIAR | adiado no porte | entrelaçado com Jev 0421 e rascunho 0419; privacidade já coberta pelo #1708 |
| 1.53.0 | #1723 | feat(midia): declare o idioma dos áudios e troque o modelo de transcrição sem copiar a chave para o .env | PORTAR | portado | correção/melhoria compatível; conflito: env sem Jev |
| 1.53.0 | #1727 | fix(funil): o quadro cabe na tela e o total da etapa em moeda sem centavos soma certo | PORTAR | portado | correção/melhoria compatível; adaptado: quadro cabe na tela + setas do fork |
| 1.53.0 | #1724 | fix(agente): com "responder em várias mensagens curtas" ligado, cada parágrafo vira uma bolha — na ordem, e a  | PORTAR | portado | correção/melhoria compatível |
| 1.53.0 | #1728 | feat(canais): editar e apagar os modelos do provedor intermediado pela tela, com prévia como no WhatsApp | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.53.0 | #1736 | docs(claude): o recibo de Idempotency-Key mora no Postgres, não no Upstash | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.53.0 | #1726 | feat(inbox): mudar a etapa do negócio pela conversa, sem abrir o quadro do funil | ADAPTAR | portado com adaptação | mover negócio entre funis/etapas pela tela — passa pela trava de saída (PT423) e precisa explicar a recusa |
| 1.53.0 | #1735 | fix(EPIC-13): torne a criação de agenda idempotente | PORTAR | portado | correção/melhoria compatível |
| 1.53.0 | #1731 | feat(midia): a retenção de mídia da organização passa a ser cumprida, e os arquivos órfãos saem do armazenamen | PORTAR | portado | correção/melhoria compatível; conflito revisado: só bloco 0432; ATENÇÃO retenção de mídia passa a apagar arquivo vencido/órfão |
| 1.53.0 | #1729 | feat(followup): o passo do fluxo manda modelo aprovado do WhatsApp e o silêncio não fala por cima do retorno c | ADIAR | adiado no porte | depende de roteiros #1573 e modelo aprovado da janela 24h; follow-up desligado; 'retorno segura o fluxo' fica pendente |
| 1.53.0 | #1737 | fix(metricas): previsão em moeda sem centavos sai na régua do negócio | ADAPTAR | portado com adaptação | campos exigidos por etapa, motivo de ganho/perda, previsão — não pode reintroduzir won obrigatório nem furar exit_locked |
| 1.54.0 | #1746 | build(deps): Sentry 11 com coleta restrita e scrub provado pelo SDK | ADIAR | não portado | troca de dependências grandes (Sentry 11, bump de 14 libs, ESLint 10) — risco sem ganho funcional agora |
| 1.54.0 | #1740 | feat(kanban): renomear a etapa direto no cabeçalho do quadro — de @lmarceloc | PORTAR | portado | correção/melhoria compatível; conflito: renomear etapa + setas do fork |
| 1.54.0 | #1742 | build(deps): bump the minor-and-patch group with 14 updates | ADIAR | não portado | troca de dependências grandes (Sentry 11, bump de 14 libs, ESLint 10) — risco sem ganho funcional agora |
| 1.54.0 | #1733 | fix(servidor): o app segura a conexão ociosa mais que quem a reaproveita (e2e-parte 1 com socket hang up) | PORTAR | portado | correção/melhoria compatível |
| 1.54.0 | #1759 | fix(admin): o Modo Plataforma ganha troca de tema, e a tarja segue o tema (extraído do #1757) | PORTAR | portado | correção/melhoria compatível |
| 1.54.0 | #1761 | Graph parceiro: editar e apagar uma variante só de modelo (hsm_id) | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.54.0 | #1762 | feat(agenda): agenda pela porta de integração — período com teto, fuso, cursor e resposta cheia | ADIAR | não portado | agenda por integração/webhook de compromisso — não usado |
| 1.54.0 | #1763 | fix(midia): a fila de remoção reabre deleted/skipped do mesmo caminho e expurga linha antiga (0434) | PORTAR | portado | correção/melhoria compatível |
| 1.54.0 | #1764 | feat(EPIC-13): permita controlar novos retornos do agente | ADAPTAR | portado com adaptação | follow-up — porta a correção, mas o gating por service_policy segue soberano (seleção e envio); adaptado: callback_enabled convive com o escopo |
| 1.55.0 | #1768 | fix(retencao): a poda da captação ordena o lote e a falha deixa de ser silenciosa | PORTAR | portado | correção/melhoria compatível |
| 1.55.0 | #1771 | Os 12 HANDOFF da raiz vão para docs/handoffs/ e um gate impede a volta | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.55.0 | #1770 | fix(doutrina): a evidência visual vai para o caminho que o git entrega (#533) | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.55.0 | #1774 | fix(teste): a quarentena da evidência segue os HANDOFF que o #1771 moveu | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.55.0 | #1773 | chore(privacidade): identificadores de produção em fixtures e comentários viram sintéticos | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.55.0 | #1777 | 0435: a contagem do expurgo da fila aparece no retorno e na trilha (#1765) | PORTAR | portado | correção/melhoria compatível |
| 1.55.0 | #1775 | fix(kit): a guarda de arquitetura não mata mais a recuperação por build local | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.55.0 | #1781 | docs(doutrina): o caso de aceite que atravessa o agente mede o par, não o modelo | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.55.0 | #1782 | test(e2e): voltar e avançar também esperam a revelação (#884) | PORTAR | portado | correção/melhoria compatível |
| 1.55.0 | #1776 | fix(#1273): "próximo NNNN livre" passa a medir a POPULAÇÃO da pergunta | ADAPTAR | portado com adaptação | ferramenta 'próximo NNNN livre' — convive com a nossa guarda de colisão |
| 1.55.0 | #1787 | feat(canais): o host da Graph vira knob por env e um receptor local prova os caminhos (#817) | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.55.0 | #1783 | fix(kit): a guarda de ARM só considera instalação real | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.55.0 | #1785 | fix(e2e): o dia escolhido é da semana desenhada, não do quadro de transição do mês | PORTAR | portado | correção/melhoria compatível |
| 1.55.0 | #1784 | fix(retencao): a poda do arquivo de webhooks ordena o lote e fala a falha | PORTAR | portado | correção/melhoria compatível |
| 1.56.0 | #1789 | feat(conversoes): regras por etapa, diagnóstico e links rastreáveis | NAO_SE_APLICA | não portado | conversões de anúncio (Meta/Google Ads) — fora da operação |
| 1.56.0 | #1791 | fix(canais): o host da Graph em http externo deixa de ser aceito em produção | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.56.0 | #1792 | fix(hooks): o "próximo NNNN" e a colisão interna medem a própria branch | ADAPTAR | portado com adaptação | ferramenta 'próximo NNNN livre' — convive com a nossa guarda de colisão |
| 1.56.0 | #1794 | perf(auth): requireRole lê papel e MFA em paralelo, mantendo a precedência — de @gustavorodcruz96 | PORTAR | portado | correção/melhoria compatível |
| 1.56.0 | #1796 | fix(auth): a leitura de fatores de MFA falha fechada | PORTAR | portado | correção/melhoria compatível |
| 1.56.0 | #1797 | fix(aviso-de-caso): o número de uma conexão removida volta a poder receber os avisos | PORTAR | portado | correção/melhoria compatível |
| 1.56.0 | #1798 | fix(leads): a etapa de destino do clone passa pela régua de campos exigidos | ADAPTAR | portado com adaptação | campos exigidos por etapa, motivo de ganho/perda, previsão — não pode reintroduzir won obrigatório nem furar exit_locked |
| 1.56.0 | #1795 | feat(inbox): busca dentro da conversa, nas mensagens já carregadas (extraída do #1793) | PORTAR | portado | correção/melhoria compatível; conflito: busca na conversa, sem botão de ligação |
| 1.56.1 | #1803 | fix(agenda): a anotação interna do compromisso aparece no detalhe | PORTAR | portado | correção/melhoria compatível |
| 1.56.1 | #1804 | fix(aviso-de-caso): reativar uma conexão não devolve o aviso para um número da própria conta | PORTAR | portado | correção/melhoria compatível |
| 1.56.1 | #1805 | fix(opt-out): 'não me contate mais', 'entrar em contato' e 'me tire da lista' passam a bloquear — de @deskcomm | ADAPTAR | portado com adaptação | vocabulário de opt-out — conferir com a nossa deteccao.ts e frases de escola |
| 1.56.1 | #1807 | fix(i18n): espanhol de conversões com tuteo neutro e calificado em vez de cualificado | PORTAR | portado | correção/melhoria compatível; conflito: i18n, auto |
| 1.56.1 | #1808 | fix(i18n): quita a dívida congelada de chaves dinâmicas com traduções em espanhol | PORTAR | portado | correção/melhoria compatível; conflito: i18n, auto |
| 1.57.0 | #1810 | docs(claude-md): pnpm no lugar de npm e comandos para rodar um teste só | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.57.0 | #1813 | feat(funil): a etapa pode avisar a equipe na Central quando um negócio entra nela | ADAPTAR | portado com adaptação | etapa avisa a equipe — útil para Equipe (humano); adaptado: etapa leva avisar_na_central + política |
| 1.57.0 | #1814 | feat(avisos): os avisos que pedem gente tocam o som que a organização escolher | PORTAR | portado | correção/melhoria compatível; conflito: i18n, auto |
| 1.57.0 | #1820 | fix(canais): no canal intermediado, o clique em anúncio fica marcado, a hora de entrega/leitura é gravada e o  | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.57.0 | #1821 | fix(canais): o WhatsApp do provedor intermediado só aceita evento da própria conta | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.57.0 | #1818 | fix(passagem): o aviso "já acionei o time" só sai se a IA falou na conversa — e uma vez por 24 h | PORTAR | portado | correção/melhoria compatível |
| 1.57.0 | #1816 | feat(casos): o caso aberto pela IA aparece no sino na hora e sai quando fecha | PORTAR | portado | correção/melhoria compatível; conflito: mapa de arquitetura, só arestas do PR |
| 1.57.0 | #1822 | scripts: worker, dev:crons e flywheel:judge abrem sem .env presente | PORTAR | portado | correção/melhoria compatível |
| 1.57.0 | #1815 | feat(avisos): os avisos que pedem gente chegam ao celular | PORTAR | portado | correção/melhoria compatível; conflito revisado: só bloco 0442 |
| 1.57.0 | #1823 | fix(canais): o canal intermediado descarta evento sem conta e só aplica status do próprio número | NAO_SE_APLICA | não portado | canal que a Capital Code não usa (Meta oficial, intermediado, Graph, voz, OAuth social) |
| 1.58.0 | #1826 | Feat/icone da aba | ADAPTAR | portado com adaptação | marca/ícone/nome — manter Capital Code CRM pelo banco; conflito: marcador de tradução; branding 39/39 |
| 1.58.0 | #1827 | fix(inbox): o fato da Memória quebra em qualquer ponto e a coluna do CRM ganha min-w-0 | PORTAR | portado | correção/melhoria compatível |
| 1.58.0 | #1830 | feat(webhooks): o webhook de saída assina a hora e identifica a entrega | PORTAR | portado | correção/melhoria compatível; conflito: só id de entrega; sem campos do #1709 |
| 1.58.0 | #1829 | fix(kanban): o total da etapa separa as moedas em vez de somá-las | PORTAR | portado | correção/melhoria compatível |
| 1.58.0 | #1834 | fix(webhooks): occurred_at segue sendo a hora do envio; a hora do fato vai em happened_at | PORTAR | portado | correção/melhoria compatível |
| 1.58.1 | #1837 | fix(kit): a atualização não acusa mais regra de isolamento que existe | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.59.0 | #1839 | fix(financeiro): o faturamento separa as moedas em vez de somá-las | NAO_SE_APLICA | não portado | módulo/financeiro de outro nicho (honorários, faturamento) |
| 1.59.0 | #1840 | chore(deps): eslint 10 tira do verify a versão que o registro aposentou | ADIAR | não portado | troca de dependências grandes (Sentry 11, bump de 14 libs, ESLint 10) — risco sem ganho funcional agora |
| 1.59.0 | #1786 | SUPABASE_SERVER_URL opcional: o servidor fala com o Supabase por um endereço só dele | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.59.0 | #1841 | docs: o README em inglês volta a acompanhar o português e o CONTRIBUTING ganha versão em inglês (#890) | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.59.0 | #1683 | Lembrete interno sem mensagem ao cliente: ação criar tarefa, nó internal_task e gatilhos de silêncio/etapa (#1 | ADIAR | adiado no porte | cadeia #1573 roteiros → #1729 → #1683; follow-up desligado |
| 1.59.0 | #1825 | fix(opt-out): freio do 'sair da lista' e sujeito de 3a antes de 'liga' | ADAPTAR | portado com adaptação | vocabulário de opt-out — conferir com a nossa deteccao.ts e frases de escola |
| 1.59.0 | #1844 | fix(health): o vigia de saúde ignora a sessão de teste do e2e em vez de vigiá-la como conexão | PORTAR | portado | correção/melhoria compatível |
| 1.60.0 | #1843 | test(mensagens): migra os quatro dublês legados do sendMessageHandler para o dublê compartilhado | ADIAR | não portado | refatoração dos dublês do sendMessageHandler — colide com os testes do kill switch sem ganho |
| 1.60.0 | #1847 | fix(marca): corrigir nome congelado do aplicativo instalado | ADAPTAR | portado com adaptação | marca/ícone/nome — manter Capital Code CRM pelo banco |
| 1.60.0 | #1848 | feat(marca): usar favicon configurado também como ícone do aplicativo | ADAPTAR | portado com adaptação | marca/ícone/nome — manter Capital Code CRM pelo banco |
| 1.60.0 | #1817 | feat(menu): Casos e Inbox mostram no menu quantos esperam uma pessoa | PORTAR | portado | correção/melhoria compatível; conflito: comentário do workflow |
| 1.60.0 | #1850 | test(invariants): gate compara o TIPO da coluna no baseline com o tipo declarado no TypeScript (#533) | PORTAR | portado | correção/melhoria compatível |
| 1.60.0 | #1851 | test(qa): varredura de classe do #686 — asserção de teto em todo identificador que cruza fronteira | PORTAR | portado | correção/melhoria compatível |
| 1.60.0 | #1819 | feat(conversoes): a venda de anúncio vai para a Meta pelo canal intermediado quando não há conexão direta | NAO_SE_APLICA | não portado | conversões de anúncio (Meta/Google Ads) — fora da operação |
| 1.60.0 | #1853 | fix(i18n): as telas fora do app declaram o idioma em que estão escritas | PORTAR | portado | correção/melhoria compatível |
| 1.60.0 | #1854 | feat(ai): permita OpenRouter nos embeddings do acervo | NAO_SE_APLICA | não portado | provedor de IA que não usamos (Requesty, OpenRouter/Gemini no acervo) |
| 1.60.0 | #1832 | feat(propostas): a empresa faz proposta comercial, do briefing da IA ao PDF que o cliente recebe | ADIAR | não portado | propostas comerciais (284 arquivos, 16 migrations) — módulo opcional; avaliar depois |
| 1.60.0 | #1855 | fix(waha): eco do envio grava o external_id na forma canônica (#196) | PORTAR | portado | correção/melhoria compatível |
| 1.61.0 | #1858 | feat(marca): logo de acesso maior, proporcional e sem ampliar bitmaps pequenos | ADAPTAR | portado com adaptação | marca/ícone/nome — manter Capital Code CRM pelo banco |
| 1.61.0 | #1861 | refactor(agent): extrai buildOpening/checkpoint para abertura/ com reexport (recorte 1 do #636) | PORTAR | portado | correção/melhoria compatível |
| 1.61.0 | #1860 | feat(crm): empresas e pessoas para quem vende B2B, como módulo opcional (recorte do #1621) | ADIAR | não portado | módulo B2B empresas/pessoas — não é o caso da escola |
| 1.61.0 | #1866 | docs(readme): add Requesty to the AI row of the stack table | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.61.0 | #1867 | test(i18n): a catraca reprova t() sobre dado que o operador digitou (cego C da #603) | PORTAR | portado | correção/melhoria compatível |
| 1.61.0 | #1578 | feat(honorarios): módulo de honorários instala, tem tela e responde pela IA | NAO_SE_APLICA | não portado | módulo/financeiro de outro nicho (honorários, faturamento) |
| 1.61.0 | #1647 | feat(grupos): grupos do WhatsApp na inbox, ligados um a um, sem IA | ADIAR | não portado | grupos do WhatsApp na inbox — nossa regra pula grupo; feature nova |
| 1.61.0 | #1868 | fix(notes): as notas internas ganham realtime e herdam a visibilidade da conversa | PORTAR | portado | correção/melhoria compatível; conflito revisado: bloco 0478 inteiro |
| 1.61.0 | #1865 | feat(roteiro): roteiro concluído não recomeça para o mesmo cliente, a não ser que o roteiro permita | ADIAR | não portado | roteiros de atendimento (feature grande, opcional, depende de 3 PRs) |
| 1.61.0 | #1864 | feat(conhecimento): a base pode ser preparada pelo Google (Gemini), com troca que refaz a base | NAO_SE_APLICA | não portado | provedor de IA que não usamos (Requesty, OpenRouter/Gemini no acervo) |
| 1.62.0 | #1871 | feat(auth): mostrar senhas no login e no cadastro | PORTAR | portado | correção/melhoria compatível |
| 1.62.0 | #1876 | Recursos opcionais: uma área só mostra o que se liga, se está ligado e onde se ajusta | ADIAR | não portado | recursos opcionais/acervo na conversa/anexo em nota/relatório por etiqueta — úteis, não críticos |
| 1.62.0 | #1874 | fix(agente): a escrita do assistente só mira um negócio do contato da conversa | PORTAR | portado | correção/melhoria compatível; conflito: teste de PR não portado fora; teste próprio verde |
| 1.62.0 | #1883 | fix(notes): anexo de imagem/arquivo dentro da nota interna, em bucket próprio (F3 da #1863) | ADIAR | não portado | recursos opcionais/acervo na conversa/anexo em nota/relatório por etiqueta — úteis, não críticos |
| 1.62.0 | #1885 | ci(e2e): sexta parte, com as specs redistribuídas pelo tempo medido | ADIAR | não portado | reorganização de CI do upstream (partes do e2e, cercas) — nosso CI tem forma própria |
| 1.62.0 | #1886 | feat(filtros): várias etiquetas com E/OU nas três listas — Inbox, Funil e Contatos | PORTAR | portado | correção/melhoria compatível; conflito: multi-etiqueta sem aba Grupos |
| 1.62.0 | #1882 | triagem: #1877 perguntar ao acervo pela conversa, com a busca da equipe à parte na Evolução — de @webtecnica | ADIAR | não portado | recursos opcionais/acervo na conversa/anexo em nota/relatório por etiqueta — úteis, não críticos |
| 1.62.0 | #1884 | fix(mídia): o caminho do arquivo não sai da pasta da conversa por .. | PORTAR | portado | correção/melhoria compatível |
| 1.62.0 | #1888 | Relatorio por etiqueta: volume, espera e desfecho de cada assunto | ADIAR | não portado | recursos opcionais/acervo na conversa/anexo em nota/relatório por etiqueta — úteis, não críticos |
| 1.63.0 | #1892 | fix(contatos): a busca entende separador e piso e para de devolver a lista inteira | PORTAR | portado | correção/melhoria compatível |
| 1.63.0 | #1890 | test(e2e): radar espera a resposta do at-risk em vez de correr contra 5 s | PORTAR | portado | correção/melhoria compatível |
| 1.63.0 | #1898 | A tela de atualização diz onde está o detalhe da disputa de banco (o .update.log) | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.63.0 | #1900 | fix(governance): o merge da main deixa de ser autoria de quem mergeia (Refs #374) | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.63.0 | #1901 | feat(db): anonimização de LGPD alcança seções de módulo declaradas (ADR-0002 D8) | ADIAR | não portado | LGPD de seções de módulo (ADR-0002) — não temos módulos com dados |
| 1.63.0 | #1903 | test(canais): a exclusão da conexão ganha prova de que o aviso dela sai junto (Refs #1023) | PORTAR | portado | correção/melhoria compatível |
| 1.63.1 | #1906 | fix(update): a conferência de isolamento só cobra regra de tabela que existe — sem falso positivo de honorário | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.63.2 | #1911 | docs(changelog): a 1.63.1 credita quem relatou a atualização travada | NAO_SE_APLICA | não portado | PR de release do upstream (versão/CHANGELOG dele) |
| 1.63.2 | #1908 | fix(card): o relógio da etapa lê stage_changed_at em vez de last_activity_at | PORTAR | portado | correção/melhoria compatível |
| 1.63.2 | #1914 | fix(followup): só manager escreve em inscrição e fluxo de follow-up — RLS por operação (#1913) | PORTAR | portado | correção/melhoria compatível; conflito revisado: só bloco 0489 |
| 1.63.2 | #1912 | fix: excluir contato com turno de follow-up apaga a ficha inteira (não perde mais o histórico) (#1862) | PORTAR | portado | correção/melhoria compatível; conflito revisado: só bloco 0488; guarda 0224 aplicada |
| 1.63.3 | #1919 | fix(followup): RLS por operação na trilha de eventos e nas versões de fluxo | PORTAR | portado | correção/melhoria compatível |
| 1.63.4 | #1922 | fix(agenda): o playbook semeado ensina os dois passos da cadeia (#1019) | PORTAR | portado | correção/melhoria compatível; conflito revisado: só bloco 0486 |
| 1.63.4 | #1928 | fix(central): o aviso de evento morto não abre em dobro ao processar o mesmo evento no mesmo instante (#880) | PORTAR | portado | correção/melhoria compatível |
| 1.63.4 | #1929 | fix(custo): id de modelo com prefixo provider/ do OpenRouter deixa de dar custo nulo (#1880) | PORTAR | portado | correção/melhoria compatível |
| 1.63.5 | #1933 | fix(tests): normaliza o separador de caminho nos dois testes do #1811 | PORTAR | portado | correção/melhoria compatível |
| 1.63.5 | #1934 | fix(inbox): o piso da busca sai o parêntese da régua, e a lista inteira deixa de voltar (#1895) | PORTAR | portado | correção/melhoria compatível |
| 1.63.5 | #1936 | fix(ia): custo sem arredondar para cima, sentimento parado sem agente no ar, frase "no credits remaining" da O | PORTAR | portado | correção/melhoria compatível; conflito: teste nascido no Jev fora |
| 1.63.6 | #1940 | fix(agente): a resposta desatualizada não sai quando o cliente escreve de novo durante o turno | ADAPTAR | portado com adaptação | resposta obsoleta não sai — integra com o nosso before-send (escopo/etapa), sem duplicar; adaptado: obsoleta + nosso before-send, sem duplicar |
| 1.63.6 | #1942 | fix(onboarding): a marca da instalação não aparecia certa ao criar um cliente novo | ADAPTAR | portado com adaptação | marca/ícone/nome — manter Capital Code CRM pelo banco |
| 1.63.6 | #1945 | fix(telas): o valor do negócio e a ficha do contato param de escrever Brasil em duro | PORTAR | portado | correção/melhoria compatível |
| 1.64.0 | #1948 | fix(inbox): o piso da busca tira o asterisco — '**' deixa de devolver a lista inteira (#1935) | PORTAR | portado | correção/melhoria compatível |
| 1.64.0 | #1949 | fix(contacts): o 409 de exclusão entrega os vínculos, e a tela avisa o que fazer e abre a Agenda (#1925) | PORTAR | portado | correção/melhoria compatível |
| 1.64.0 | #1950 | fix(ai): o painel de Skills avisa quando o catálogo publica versão nova de um playbook copiado e deixa adotar  | PORTAR | portado | correção/melhoria compatível |
| 1.64.1 | #1831 | fix(agenda): a grade desenha no fuso da organização, não no do navegador | PORTAR | portado | correção/melhoria compatível |
| 1.64.1 | #1958 | feat(lgpd): cascata redige a memória da IA, argumentos de ferramentas, estado da lead e identidade social (#19 | PORTAR | portado | correção/melhoria compatível |
| 1.64.1 | #1961 | fix(branding): nome da marca em texto lê a configuração do banco, com .env como piso (#1944) | ADAPTAR | portado com adaptação | marca/ícone/nome — manter Capital Code CRM pelo banco |
| 1.64.1 | #1960 | fix(ai): editar cópia de playbook preserva o vínculo com o catálogo e o aviso de versão nova (#1951) | PORTAR | portado | correção/melhoria compatível |
| 1.65.0 | #1968 | fix(ia): turno descartado como resposta obsoleta não emite a pergunta do roteiro | ADIAR | não portado | roteiros de atendimento (feature grande, opcional, depende de 3 PRs) |
| 1.65.0 | #1969 | fix(lgpd): exportação do titular inclui lead_notes, tool_calls e lead_state | PORTAR | portado | correção/melhoria compatível; conflito: só os trechos do PR no export |
| 1.65.0 | #1973 | fix(lgpd): cascata do banco alcança lead_notes, tool_calls, lead_state e social_identity | PORTAR | portado | correção/melhoria compatível |
| 1.65.0 | #1979 | test(e2e): virada de mês do painel espera pelo dia futuro, não por qualquer dia | PORTAR | portado | correção/melhoria compatível |
| 1.65.0 | #1938 | feat(installer): habilita instalação do DeskcommCRM em ARM64 | NAO_SE_APLICA | não portado | kit/instalador/update.sh do self-host genérico; nosso deploy é scripts/deploy-vps.sh (fail-closed próprio) |
| 1.65.0 | #1972 | feat(ai): painel de skills mostra o que mudou entre a cópia e a versão nova do catálogo | PORTAR | portado | correção/melhoria compatível |
| 1.66.0 | #1984 | feat(pacing): janela de resposta separada da janela de disparo (0495) — de @suporteubere99-coder | ADAPTAR | portado com adaptação | janela de resposta/atraso humano/rajada — convive com o kill switch e a política de etapa; adaptado: janela de resposta + janela que cruza meia-noite |
| 1.66.1 | #1989 | fix(lgpd): anonimizar apaga também a transcrição da mídia (media_derived_text) | PORTAR | portado | correção/melhoria compatível; conflito: dublê do teste LGPD |
| 1.67.0 | #1994 | test(agenda): cerca — paraEventoDoGoogle nunca vaza a anotação interna (#1959) | PORTAR | portado | correção/melhoria compatível |
| 1.67.0 | #1996 | feat(agent): atraso humano configurável por conexão (0499) | ADAPTAR | portado com adaptação | janela de resposta/atraso humano/rajada — convive com o kill switch e a política de etapa |
| 1.67.0 | #1997 | feat(agent): janela de rajada do WhatsApp configurável por agente (0498) | ADAPTAR | portado com adaptação | janela de resposta/atraso humano/rajada — convive com o kill switch e a política de etapa; adaptado: colunas da versão unidas; sem coluna de propostas |
| 1.68.0 | #2006 | fix(agent): respeita escopo de funis no espelho de etapa | PORTAR | portado | correção/melhoria compatível |
| 1.68.0 | #1747 | feat(ia): o Jev percebe pedidos de pessoa e de parar de receber que a regra deixa passar, e pode avisar a equi | NAO_SE_APLICA | não portado | Jev (serviço externo da TypeSafe) — não habilitar, sem dependência paga |
| 1.68.0 | #2008 | fix(baseline): deduplica backfill 0068 por model_id | PORTAR | portado | correção/melhoria compatível |
| 1.68.0 | #1956 | docs(adr): ADR-0004 — cobrança do revendedor, e a spec que a detalha | NAO_SE_APLICA | não portado | documentação/governança do repositório upstream |
| 1.69.0 | #1766 | fix(followup): "Classificar resposta" espera o cliente responder — e lê a resposta ao envio do fluxo | ADAPTAR | portado com adaptação | follow-up — porta a correção, mas o gating por service_policy segue soberano (seleção e envio) |
| 1.69.0 | #1772 | feat(ia): o Jev lê a resposta ao follow-up ao lado da IA de sempre, só observando (onda 4.1) | NAO_SE_APLICA | não portado | Jev (serviço externo da TypeSafe) — não habilitar, sem dependência paga |
