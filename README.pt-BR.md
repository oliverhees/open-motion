<p align="center">
  <a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <b>Português</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

[![Open Motion — Cada elemento é uma camada.](docs/assets/open-motion-hero.jpg)](docs/assets/open-motion-hero.jpg)

# Open Motion

**O estúdio de motion graphics open source e auto-hospedado em que cada elemento é uma camada editável ao vivo.**

[![Licença: AGPL v3](https://img.shields.io/badge/Licen%C3%A7a-AGPL--3.0-blue.svg)](LICENSE) [![Status](https://img.shields.io/badge/Status-Beta%200.1-orange.svg)](#-status) [![Stack](https://img.shields.io/badge/Stack-HyperFrames%20%2B%20Web%20Animations-informational.svg)](#-arquitetura) [![Auto-hospedado](https://img.shields.io/badge/Auto--hospedado-Docker%20%2B%20Coolify-black.svg)](docs/deploy-coolify.md) [![Testes](https://img.shields.io/badge/Testes-90%20passando-brightgreen.svg)](#-status)

*Descreva seu vídeo, fale para a sua facecam ou arraste arquivos. A IA monta as camadas, você ajusta ao vivo e no final sai um MP4.*

![Showcase](docs/assets/showcase.gif)

[Início rápido](#-início-rápido) · [Recursos](#-recursos) · [Capturas](#-capturas-de-tela) · [Arquitetura](#-arquitetura) · [Deploy com Coolify](docs/deploy-coolify.md) · [Guia](docs/guide.md) · [Licença](#-licença)

---

## Por que Open Motion

Geradores de vídeo com IA entregam pixels prontos. Se uma palavra do título estiver errada ou um gráfico ficar alguns centímetros para a esquerda, você gera tudo de novo e torce. Editores clássicos dão controle total, mas cada animação custa horas.

O Open Motion segue um terceiro caminho: **motion graphics como código.** Cada elemento é uma camada própria com quadro, conteúdo e tempo. A IA escreve essas camadas e você as manipula direto no editor: arrastar, redimensionar, digitar. A renderização acontece só no final, com Chrome headless e FFmpeg, quadro a quadro, exatamente como na pré-visualização.

E tem o que um vídeo explicativo precisa: gravação de facecam no navegador, transcrição com tempo por palavra, gráficos ancorados em palavras faladas e corte direto no texto. Apague um tropeço na fala e facecam, áudio e gráficos se ajustam sozinhos.

## 🏆 Comparação

|  | Geradores de vídeo com IA | Editores de vídeo clássicos | Open Motion |
| --- | --- | --- | --- |
| **Alterar um único elemento** | ❌ geralmente gerar tudo de novo | ✅ à mão | ✅ clique, digite ou comente para a IA; só aquele elemento muda |
| **Trocar conteúdo, manter o quadro** | ❌ | ⚠️ trabalhoso | ✅ gráfico → imagem de IA → vídeo; posição e animação permanecem |
| **Facecam + transcrição + corte por texto** | ❌ | ⚠️ muitas vezes software extra | ✅ integrado; gráficos acompanham as palavras nos cortes |
| **Escolher o modelo de IA** | ❌ o do fornecedor | ❌ | ✅ suas próprias chaves: Claude, OpenAI, OpenRouter; imagens via Kie.ai, OpenAI, OpenRouter, Gemini |
| **Auto-hospedado, seus dados ficam com você** | ❌ nuvem | ✅ local | ✅ Docker + Coolify, uma pasta por projeto |
| **Código-fonte** | ❌ | ❌ na maioria | ✅ AGPL-3.0 |

Sendo honestos: descrever animações como código e renderizá-las no navegador não é uma ideia nova. O que acrescentamos é tudo o que falta quando você só renderiza: um modelo de camadas que IA **e** pessoas editam ao mesmo tempo, um editor ao vivo sem recarregar, um fluxo de facecam com corte por texto e uma renderização que se ajusta sozinha ao hardware.

## ✨ Recursos

- **Sistema de camadas:** texto, formas, gráficos desenhados (SVG), imagens, vídeo, áudio, com quadro, keyframes, easing e transições de entrada e saída.
- **Editor ao vivo:** clicar, arrastar, redimensionar, digitar direto na pré-visualização. Mudou algo no cabeçote, um keyframe é criado automaticamente.
- **Faixa de cenas e ajustes:** nome, duração e velocidade por cena, mais todos os textos da cena.
- **Chat de IA:** "Faça uma animação de 20 segundos para o meu café" → cenas, textos, gráficos, imagens. Cada resposta pode ser desfeita separadamente.
- **Comentários em elementos:** clique em um elemento, escreva "@IA deixe verde", pronto.
- **Facecam:** grave no navegador ou envie um arquivo, áudio em faixa própria, layouts (grande, canto, círculo, dividido) com transições suaves.
- **Transcrição com tempo por palavra:** local com faster-whisper ou via OpenAI, ElevenLabs, Groq, Deepgram.
- **Âncoras:** gráficos presos a palavras faladas.
- **Corte por texto:** apagar palavras corta o vídeo. Vícios de linguagem e pausas longas são sugeridos; o áudio recebe micro fades sem estalos na exportação.
- **Imagens com IA:** Kie.ai, OpenAI, OpenRouter ou Gemini, salvas localmente na hora.
- **Exportação:** MP4 ou GIF, 720p ou 1080p, 15/30/60 fps, texto mais nítido opcional.
- **Renderização autoajustável:** detecta CPU, RAM e GPU (inclusive limites de contêiner) e aprende com cada exportação.
- **Interface bilíngue:** inglês e alemão.
- **Auto-hospedado:** imagem Docker nas variantes `slim` e `whisper`, editor e worker de renderização separados.

## 📸 Capturas de tela

| Editor ao vivo | Chat de IA |
| --- | --- |
| [![Editor](docs/assets/editor.png)](docs/assets/editor.png) | [![Chat de IA](docs/assets/ai-chat.png)](docs/assets/ai-chat.png) |
| **Transcrição e âncoras** | **Corte por texto** |
| [![Transcrição](docs/assets/transcript-anchors.png)](docs/assets/transcript-anchors.png) | [![Corte por texto](docs/assets/text-cut.png)](docs/assets/text-cut.png) |

<sub>A captura do chat de IA mostra uma conversa encenada; as alterações citadas foram de fato aplicadas ao projeto.</sub>

**Vídeo de exemplo**, renderizado inteiramente a partir de uma Motion-Spec:

![Exemplo](docs/assets/example.gif)

## 🚀 Início rápido

**Com Docker (recomendado):**

```bash
git clone https://github.com/oliverhees/open-motion.git
cd open-motion
cp .env.example .env            # defina OPENMOTION_PASSWORD
docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env up --build
# → http://localhost:4317
```

**Sem Docker (Node 22.18+, FFmpeg):**

```bash
npm install
npx hyperframes browser ensure  # Chrome para renderizar (uma vez)
npm run example:assets          # arquivos de exemplo (Python + Pillow)
npm run editor:build
npm start                       # → http://localhost:4317
```

Depois: ⚙ Configurações → adicione suas chaves de API → 🩺 **Testar agora**.

**No seu servidor:** [guia do Coolify passo a passo](docs/deploy-coolify.md)

## 🧩 Arquitetura

**O núcleo** é a **Motion-Spec**, um arquivo JSON com cenas e camadas. Editor, IA e renderizador só leem e escrevem esse arquivo. As mudanças passam exclusivamente por **patches** como `set`, `setAt` (keyframe automático), `swap` (trocar conteúdo, manter o quadro) ou `cut` (corte por texto). Cada patch é validado e os erros voltam em linguagem clara, para que a IA possa se corrigir.

**Stack:** [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache 2.0) renderiza HTML em vídeo. A animação usa a **Web Animations API** do navegador, de propósito sem GSAP, cuja licença proíbe o uso em editores visuais de animação. TypeScript roda direto no Node 22; o editor é React + Vite. Editor e worker se comunicam por uma fila baseada em arquivos.

Mais: [Guia](docs/guide.md) · [Referência da Motion-Spec](docs/motion-spec.md)

## 🛡️ Segurança

Login por senha com cookie `HttpOnly`/`SameSite=Lax` (`Secure` atrás de HTTPS) e bloqueio após 10 tentativas; tokens de API guardados apenas como hash; chaves dos fornecedores nunca enviadas ao navegador; proteção CSRF; SVG gerado por IA sanitizado; contêiner sem root. Vulnerabilidade? Veja [SECURITY.md](SECURITY.md).

## 🔧 Status

**Beta 0.1, coberta por 90 testes automatizados e testes de ponta a ponta.** Pronto: núcleo de camadas, editor ao vivo, facecam, transcrição local, corte por texto, agente de IA (modo de teste e fornecedores simulados), login e tokens, editor e worker separados, renderização autoajustável. A seguir: teste ao vivo de todas as APIs com chaves reais, build Docker confirmado no Coolify, conector MCP e Skill.

**Limitações conhecidas:** as APIs de IA, imagem e transcrição seguem a documentação e os formatos de resposta dos fornecedores; o teste com chaves reais está em andamento. Cenas inteiras ainda não acompanham os cortes por texto. Há uma única senha para todos. Algumas mensagens do servidor ainda estão em alemão.

Detalhes: [STATUS.md](STATUS.md)

## 🗺️ Roadmap

1. **Conector MCP** para Claude (web, Code, Cowork), Hermes e outros agentes.
2. **Skill** com regras de design, resumo da spec e exemplos.
3. **Cenas ancoradas em palavras.**
4. **Timeline profissional:** faixas, curvas de keyframes, faixas de áudio.

## 📜 Licença

O núcleo está sob a **[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)**, licença open source aprovada pela OSI. Copyleft: se você modificar o Open Motion e oferecê-lo como serviço em rede, precisa publicar também o código modificado. **Sem GSAP.**

## 🏠 Não quer auto-hospedar?

Você pode rodar o Open Motion na sua própria infraestrutura ([guia do Coolify](docs/deploy-coolify.md)). Se preferir, **operamos uma instância dedicada para você.** Contato: [aiianer.de](https://aiianer.de) ou [Issues](https://github.com/oliverhees/open-motion/issues).

## 🤝 Contribuir

Issues, pull requests e discussões são bem-vindos. Veja [CONTRIBUTING.md](CONTRIBUTING.md) e o [Código de conduta](CODE_OF_CONDUCT.md).

---

<p align="center">Feito com ❤️ e paixão por <b>Oliver Hees – Der Aiianer</b> · <a href="https://aiianer.de">aiianer.de</a> · <a href="LICENSE">AGPL-3.0</a></p>
