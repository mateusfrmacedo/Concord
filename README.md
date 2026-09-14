# ScreenLink

Aplicativo desktop mínimo para compartilhar uma tela entre duas pessoas usando WebRTC.

## Executar localmente

Em um terminal, inicie o servidor de sinalização:

```bash
npm run server
```

Em outro terminal, abra o aplicativo:

```bash
npm start
```

Para testar com dois computadores na mesma rede, inicie o servidor em um deles e informe, nos dois apps, o endereço `http://IP-DO-SERVIDOR:3000`. O apresentador cria uma sala e compartilha seu código; o espectador digita esse código para assistir.

## Limites desta primeira versão

- Há um apresentador por sala e um espectador por vez.
- Para conexões fora da mesma rede, configure um servidor TURN antes de uso real: algumas redes bloqueiam conexões WebRTC diretas.
- O áudio do sistema depende das permissões e do suporte de cada versão do Windows ou macOS.
