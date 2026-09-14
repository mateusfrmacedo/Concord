# Compartilhamento de tela

Aplicativo desktop para compartilhar uma tela entre amigos usando WebRTC.

## Executar localmente

Crie uma aplicação OAuth no Discord Developer Portal. Copie `.env.example` para `.env`, informe as credenciais do Discord e inicie o servidor:

Para Discord, cadastre `http://127.0.0.1:8912/oauth/callback` como Redirect URL no Developer Portal.

```bash
npm run server
```

Em outro terminal, abra o aplicativo:

```bash
npm start
```

Para testar com dois computadores na mesma rede, inicie o servidor em um deles e informe, nos dois apps, o endereço `http://IP-DO-SERVIDOR:3000` em Conexão. Depois do login, os usuários podem encontrar contas que já entraram no servidor e enviar pedidos de amizade.

## Limites desta primeira versão

- Há um apresentador por sala e um espectador por vez.
- Para conexões fora da mesma rede, configure um servidor TURN antes de uso real: algumas redes bloqueiam conexões WebRTC diretas.
- O áudio do sistema depende das permissões e do suporte de cada versão do Windows ou macOS.
