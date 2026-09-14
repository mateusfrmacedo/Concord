# Concord

Aplicativo desktop para compartilhar uma tela entre amigos usando WebRTC.

## Executar localmente

Crie um OAuth Client do tipo **Desktop app** no Google Cloud, copie `.env.example` para `.env` e informe o Client ID. Em seguida, inicie o servidor:

```bash
GOOGLE_CLIENT_ID="seu-client-id.apps.googleusercontent.com" npm run server
```

Em outro terminal, abra o aplicativo:

```bash
GOOGLE_CLIENT_ID="seu-client-id.apps.googleusercontent.com" npm start
```

Para testar com dois computadores na mesma rede, inicie o servidor em um deles e informe, nos dois apps, o endereço `http://IP-DO-SERVIDOR:3000` em Conexão. Depois do login, os usuários podem encontrar contas que já entraram no servidor e enviar pedidos de amizade.

## Limites desta primeira versão

- Há um apresentador por sala e um espectador por vez.
- Para conexões fora da mesma rede, configure um servidor TURN antes de uso real: algumas redes bloqueiam conexões WebRTC diretas.
- O áudio do sistema depende das permissões e do suporte de cada versão do Windows ou macOS.
