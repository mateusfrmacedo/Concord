# Compartilhamento de tela

Aplicativo desktop para compartilhar uma tela entre amigos usando WebRTC.

## Executar localmente

Crie uma aplicação OAuth no Discord Developer Portal. Copie `.env.example` para `.env`, informe as credenciais do Discord e inicie o servidor:

Defina `PUBLIC_URL` com a URL HTTPS pública do servidor e cadastre `PUBLIC_URL/oauth/discord/callback` como Redirect URL no Developer Portal. O segredo do Discord permanece somente no servidor; o aplicativo desktop recebe uma sessão temporária após o login.

```bash
npm run server
```

Em outro terminal, abra o aplicativo:

```bash
npm start
```

Para testar com dois computadores na mesma rede, inicie o servidor em um deles e informe, nos dois apps, o endereço `http://IP-DO-SERVIDOR:3000` em Conexão. Depois do login, os usuários podem encontrar contas que já entraram no servidor e enviar pedidos de amizade.

## Hospedagem

O repositório inclui `Dockerfile` e `railway.toml`. Em Railway, crie um projeto a partir deste repositório, adicione um Volume em `/app/data` e configure `PUBLIC_URL`, `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`. Use o domínio HTTPS fornecido pela plataforma como `PUBLIC_URL` e registre o callback correspondente no Discord Developer Portal.

## Limites desta primeira versão

- Há um apresentador por sala e um espectador por vez.
- Para conexões fora da mesma rede, configure um servidor TURN antes de uso real: algumas redes bloqueiam conexões WebRTC diretas.
- O áudio do sistema depende das permissões e do suporte de cada versão do Windows ou macOS.
