---
impacto: capacidade_nova
secao: alterado
titulo: Logo acima de 512 KB passa a ser recortado e reduzido no navegador em vez de recusado
---

Em Configurações › Marca, um logo acima de 512 KB não é mais recusado de cara: antes do envio, o próprio navegador recorta a margem totalmente transparente em volta do logo e, se ainda não couber, reduz a largura para 800, 640 ou 512 px, mantendo a proporção e a transparência do PNG. Só quando nem assim cabe a tela mostra a recusa, sem enviar o arquivo. O limite de 512 KB continua o mesmo, e o servidor segue conferindo tamanho e tipo.

Contribuição de @webtecnica (#1671), a partir do relato de @spoliagency na #1655.
