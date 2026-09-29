# Contribuindo com o Enterview

Obrigado pelo interesse em contribuir! Este documento explica como preparar o ambiente, propor mudanças e abrir pull requests.

## Código de conduta

Ao participar do projeto, siga o [Código de Conduta](CODE_OF_CONDUCT.md).

## Antes de começar

1. Verifique as [issues abertas](https://github.com/SEU_USUARIO/enterview/issues) para evitar trabalho duplicado.
2. Para bugs, use o template de bug report.
3. Para novas ideias, use o template de feature request.
4. Para mudanças maiores, abra uma issue antes de implementar para alinharmos a solução.

## Desenvolvimento local

Consulte o README para os requisitos e os comandos específicos do projeto. Depois de clonar o repositório, instale as dependências e configure as variáveis de ambiente indicadas no arquivo `.env.example`, quando ele existir.

Antes de enviar uma contribuição, execute os comandos disponíveis no projeto para lint, testes e build. Exemplos comuns:

```bash
npm run lint
npm test
npm run build
```

Se algum desses scripts não existir, execute apenas os scripts definidos no `package.json`.

## Branches

Crie uma branch específica para cada mudança:

```bash
git checkout -b feat/nome-da-feature
git checkout -b fix/descricao-do-bug
```

Prefira nomes curtos e descritivos, como `docs/contributing` ou `refactor/interview-form`.

## Commits

Use mensagens claras e, de preferência, o padrão abaixo:

- `feat:` para nova funcionalidade;
- `fix:` para correção de bug;
- `docs:` para documentação;
- `refactor:` para refatoração sem mudança de comportamento;
- `test:` para testes;
- `chore:` para manutenção.

Exemplos:

```text
feat: adicionar filtro por status da sessão
feat: adicionar modo de revisão de questões
```

## Pull requests

Antes de abrir um PR:

- mantenha o PR focado em um único objetivo;
- atualize a documentação quando necessário;
- adicione ou ajuste testes para mudanças de comportamento;
- rode lint, testes e build;
- inclua screenshots ou vídeos quando houver mudança visual;
- descreva como a mudança pode ser verificada.

O mantenedor pode pedir ajustes, testes adicionais ou dividir o PR em partes menores. Isso faz parte do processo normal de revisão.

## Dúvidas

Abra uma issue com a label `question` ou use as discussões do GitHub, se estiverem habilitadas.
