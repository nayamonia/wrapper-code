> Esta traducción puede estar desactualizada con respecto al README en inglés.

[English](README.md) · [Português](README.pt-BR.md) · Español

# wrapper-code

Ejecuta el CLI de [Claude Code](https://docs.anthropic.com/en/docs/claude-code) con otros proveedores de LLM o con varias cuentas de Claude a la vez, sin modificar la configuración de Claude Code.

Sitio web: [nayamonia.github.io/wrapper-code](https://nayamonia.github.io/wrapper-code/) · Paquete: [npmjs.com/package/wrapper-code](https://www.npmjs.com/package/wrapper-code)

`wrapper-code deepseek` abre una sesión interactiva normal de Claude Code que se comunica con DeepSeek. Ejecutar `claude` directamente sigue utilizando Anthropic, exactamente como antes. No se escribe nada en `~/.claude` y ninguna variable se filtra a tu shell: la configuración del proveedor existe únicamente dentro de esa sesión.

Cada sesión registra el uso de tokens en tu equipo, y `wrapper-code usage` calcula los totales por proveedor y modelo. `wrapper-code claude` inicia tu Claude Code habitual sin modificarlo, por lo que su uso de Anthropic también aparece en el mismo informe.

También permite administrar varias cuentas de Claude al mismo tiempo, por ejemplo, un plan Max personal y una cuenta Team de la empresa con el mismo correo electrónico. `wrapper-code claude --account work` abre una sesión iniciada con una de esas cuentas, utilizando tu configuración habitual, plugins y servidores MCP, mientras que `claude` sigue utilizando su propio inicio de sesión. Las sesiones de distintas cuentas pueden ejecutarse simultáneamente en terminales separadas. `wrapper-code claude --temp` inicia sesión únicamente para una sesión y elimina el inicio de sesión al salir. Consulta [Cuentas de Claude](#claude-accounts) (macOS y Linux).

![El mismo prompt en dos terminales: wrapper-code claude a la izquierda y wrapper-code deepseek a la derecha; después, wrapper-code usage muestra las solicitudes y los tokens de ambos](https://nayamonia.github.io/wrapper-code/demo.gif)

*El mismo prompt en dos terminales: `wrapper-code claude` a la izquierda y `wrapper-code deepseek` a la derecha. Cuando ambas sesiones terminan, `wrapper-code usage` muestra las solicitudes y los tokens de cada una.*

## Instalación

Requiere Node.js 18+ y Claude Code (`npm install -g @anthropic-ai/claude-code`).

```bash
npm install -g wrapper-code
```

Compatible con macOS, Linux y Windows.

## Uso

```bash
wrapper-code deepseek              # iniciar Claude Code con DeepSeek
wrapper-code ollama                # iniciar Claude Code con un modelo local de Ollama
wrapper-code ollama --model gemma3 # utilizar otro modelo principal solo en esta sesión
wrapper-code qwencloud             # iniciar Claude Code con Qwen Cloud (pago por uso)
wrapper-code qwencloud-token       # iniciar Claude Code con el plan de tokens de Qwen Cloud (Qwen, DeepSeek, GLM)
wrapper-code openrouter            # iniciar Claude Code con cualquier modelo de OpenRouter (OpenAI, Google, Meta, Mistral, xAI...)
wrapper-code kimi                  # iniciar Claude Code con Kimi mediante la API de Moonshot (pago por token)
wrapper-code kimi-code             # iniciar Claude Code con tu suscripción Kimi Code
wrapper-code zai-coding            # iniciar Claude Code con el plan GLM Coding de Z.ai
wrapper-code deepseek --resume     # cualquier argumento después del proveedor se pasa a claude
wrapper-code claude                # tu Claude Code habitual, sin cambios, registrando su uso de tokens
wrapper-code accounts add work     # iniciar sesión con otra cuenta de Claude, separada de tu cuenta habitual
wrapper-code claude --account work # utilizar esa cuenta con Claude Code
wrapper-code claude --temp         # iniciar sesión solo para esta sesión; cerrar sesión y eliminarla al salir
wrapper-code accounts              # mostrar las cuentas guardadas, sus correos y el último uso
wrapper-code setup deepseek        # cambiar la API key o el perfil del modelo
wrapper-code list                  # mostrar los proveedores por familia: facturación, estado y perfil o modelo seleccionado
```

`wrapper-code list` agrupa los proveedores de una misma familia y muestra su modalidad de facturación (`plan`, `payg` o `local`):

```
FAMILY     PROVIDER         BILLING  STATUS          SELECTION
anthropic  claude           plan     configured      -
deepseek   deepseek         payg     configured      flash-1m
gateway    openrouter       payg     not configured  -
glm        zai-coding       plan     not configured  -
kimi       kimi-code        plan     configured      k3-1m
kimi       kimi             payg     not configured  -
local      ollama           local    configured      qwen3-coder
qwen       qwencloud-token  plan     configured      auto
qwen       qwencloud        payg     not configured  -
```

La primera vez que inicies un proveedor, se abrirá una página de configuración en tu navegador en `127.0.0.1`. Introduce tu API key, selecciona un perfil de modelo y haz clic en **Test and save**. La clave se verifica con la API del proveedor antes de guardarse. Después, la sesión se inicia inmediatamente.

## Proveedores

| Proveedor         | Configuración                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Documentación                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `deepseek`        | API key. Perfiles: `flash-1m` (predeterminado): DeepSeek Flash con un contexto de 1M. `v4-pro`: DeepSeek V4 Pro como modelo principal y Flash para los subagentes.                                                                                                                                                                                                                                                                                                            | [DeepSeek × Claude Code](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/)             |
| `ollama`          | No requiere clave. La página de configuración muestra los modelos instalados en tu Ollama local (predeterminado `http://localhost:11434`, editable para un servidor remoto) y guarda uno como predeterminado. Los modelos sin compatibilidad con herramientas aparecen en la lista, pero no se pueden seleccionar. Permite ejecutar Qwen Coder, Gemma, Llama, Mistral y otros modelos de Ollama sin conexión.                                                                 | [Ollama × Claude Code](https://docs.ollama.com/integrations/claude-code)                                        |
| `qwencloud`       | API key de Qwen Cloud (pago por uso, comienza con `sk-`, se crea en home.qwencloud.com/api-keys; las cuentas nuevas reciben una cuota gratuita). Un perfil, `pay-as-you-go`: Qwen 3.8 Max como modelo principal, Qwen 3.8 Flash para Sonnet y los subagentes, Qwen 3.6 Flash para Haiku y un contexto de 983k.                                                                                                                                                                | [Qwen Cloud × Claude Code](https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code) |
| `qwencloud-token` | API key del Token Plan (Personal o Team Edition, comienza con `sk-sp-`), obtenida desde la consola de Qwen Cloud o Alibaba Model Studio. Perfiles: `auto` (predeterminado): selección automática, como se describe en la documentación de Qwen Cloud. `qwen-max`: Qwen 3.8 Max y Qwen 3.8 Flash para subagentes. `qwen-plus`: Qwen 3.7 Plus para todos los roles. `deepseek-pro`: DeepSeek V4 Pro y DeepSeek V4.1 Flash para subagentes. `glm`: GLM 5.3 para todos los roles. | [Qwen Cloud × Claude Code](https://docs.qwencloud.com/developer-guides/clients-and-developer-tools/claude-code) |
| `openrouter`      | API key de OpenRouter (`openrouter.ai/keys`), cuya validez se comprueba gratuitamente. La página de configuración muestra todos los modelos disponibles en OpenRouter e incluye un cuadro de búsqueda. Los modelos sin compatibilidad con llamadas a herramientas aparecen, pero no se pueden seleccionar. El modelo elegido se utiliza para todos los roles, incluidos los subagentes. La facturación se realiza mediante tus créditos de OpenRouter.                        | [OpenRouter × Claude Code](https://openrouter.ai/docs/guides/guides/claude-code-integration)                    |
| `kimi`            | API key de Moonshot obtenida en platform.kimi.ai. Pago por token; la clave se verifica gratuitamente mediante la ruta de modelos. Perfiles: `k3-1m` (predeterminado): Kimi K3 con contexto de 1M y K2.7 Code para el nivel Haiku. `k2.7-code`: Kimi K2.7 Code para todos los roles, con contexto de 256k; activa el modo de razonamiento en Claude Code (Alt+T / Option+T).                                                                                                   | [Kimi × Claude Code](https://platform.kimi.ai/docs/guide/claude-code-kimi)                                      |
| `kimi-code`       | API key de Kimi Code (requiere una membresía de Kimi con Kimi Code; se crea en la consola de Kimi Code). Se verifica gratuitamente mediante la ruta de modelos. Perfiles: `k3-1m` (predeterminado): Kimi K3 con contexto de 1M para todos los roles. `k3-256k`: Kimi K3 con contexto de 256k.                                                                                                                                                                                 | [Kimi Code × Claude Code](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html)                 |
| `zai-coding`      | API key de Z.ai (suscripción GLM Coding Plan, creada en la sección API Keys de z.ai). Se verifica gratuitamente mediante la ruta de modelos. Con el plan activo, cada llamada cuenta para la cuota del plan, nunca para el saldo de la cuenta ni para los paquetes de uso. Perfiles: `glm-5.3` (predeterminado): GLM 5.3 y GLM 5.3 Flash para el nivel Haiku. `glm-5.3-1m`: lo mismo, con contexto de 1M. `flash`: GLM 5.3 Flash para todos los roles, para ahorrar cuota.    | [Z.ai × Claude Code](https://docs.z.ai/devpack/tool/claude)                                                     |
| `claude`          | No requiere configuración. Ejecuta tu Claude Code habitual exactamente como lo hace `claude` (tu inicio de sesión, tus modelos y tu configuración; no se añade ni elimina ninguna variable), con el receptor de uso activado. Así, el uso de Anthropic aparece en `wrapper-code usage` junto con el de los demás proveedores.                                                                                                                                                 | [Supervisión del uso de Claude Code](https://code.claude.com/docs/en/monitoring-usage)                          |

El prompt del sistema y las herramientas de Claude Code pueden superar los 32k tokens, mientras que Ollama procesa las solicitudes con su propio contexto de ejecución (`OLLAMA_CONTEXT_LENGTH`, que suele ser de 32k o menos de forma predeterminada), no con el máximo del modelo. Si una solicitud no cabe, se trunca silenciosamente y parece que el modelo ignora el prompt. Configura el contexto servido por Ollama en al menos 64k, por ejemplo, con `OLLAMA_CONTEXT_LENGTH=65536 ollama serve`, o utiliza la configuración de longitud de contexto de la aplicación Ollama.

El wrapper guarda la longitud máxima de contexto del modelo seleccionado en `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, para que Claude Code compacte la conversación antes de que se desborde la ventana. Este valor es el máximo del modelo, no el contexto que tu servidor está configurado para ofrecer.

`--model` sustituye el modelo principal únicamente durante esa sesión; los subagentes y las tareas en segundo plano siguen utilizando el modelo guardado.

Las configuraciones de Qwen Cloud (`qwencloud` y `qwencloud-token`) validan la clave mediante una solicitud de un token a `/v1/messages`, porque esos endpoints no tienen una ruta para listar modelos. La configuración consume un token de salida.

Alibaba Model Studio y Qwen Cloud utilizan el mismo backend: una clave Token Plan de cualquiera de las dos consolas funciona con `qwencloud-token`. El antiguo proveedor `alibaba` ahora es un alias de `qwencloud-token`: `wrapper-code alibaba` sigue funcionando y `alibaba.env` cambia a `qwencloud-token.env` la primera vez que utilizas cualquiera de los dos nombres. Su historial de uso aparece bajo `qwencloud-token`. Alibaba Coding Plan fue retirado, por lo que el antiguo proveedor `qwen` ya no está disponible. Los archivos antiguos `qwen.env` o `alibaba-token.env` del directorio de configuración simplemente se ignoran.

Con OpenRouter puedes elegir modelos de OpenAI, Google, Meta, Mistral, xAI y otros mediante una sola clave. Para utilizar un modelo más económico en subagentes y tareas en segundo plano, edita `ANTHROPIC_DEFAULT_HAIKU_MODEL` y `CLAUDE_CODE_SUBAGENT_MODEL` en `~/.config/wrapper-code/openrouter.env`; el wrapper conserva las claves escritas manualmente. OpenRouter advierte que Claude Code está optimizado para modelos de Anthropic, por lo que otros modelos pueden funcionar peor durante sesiones agénticas prolongadas.

Actualmente se puede acceder a MiniMax mediante OpenRouter; está previsto añadir un proveedor específico. Z.ai no ofrece una modalidad de pago por uso: en una cuenta con GLM Coding Plan, las llamadas de Claude Code siempre consumen la cuota del plan. Cada proveedor se define en un único archivo de datos dentro de `src/providers/`; las contribuciones mediante pull requests son bienvenidas. [CONTRIBUTING.md](CONTRIBUTING.md) explica los campos y la lista de comprobación.

## Cuentas de Claude

Puedes mantener varias cuentas de Claude (Pro, Max, Team o Enterprise) al mismo tiempo, sin modificar el inicio de sesión de `claude`. Disponible únicamente en macOS y Linux.

* `wrapper-code accounts add <name>` crea una cuenta e inicia `claude auth login` para ella.
* `wrapper-code claude --account <name> [claude args...]` inicia tu Claude Code con esa cuenta.
* `wrapper-code claude --temp [claude args...]` inicia sesión para una sola sesión. Cuando termina, se cierra la sesión y se elimina su carpeta. Si el cierre de sesión falla, la carpeta se conserva y se muestra su ruta; el siguiente uso de `--temp` o `accounts` vuelve a intentarlo.
* `wrapper-code accounts` muestra las cuentas, sus correos electrónicos, organizaciones y último uso. `wrapper-code accounts remove <name> [--yes]` cierra la sesión y elimina una cuenta (`--yes` omite la confirmación y es obligatorio cuando no hay terminal).
* Un mismo correo puede pertenecer a varias organizaciones, por ejemplo, un plan personal y una cuenta Team. Añade una cuenta por organización (`accounts add pessoal`, `accounts add time`) y selecciona la organización en el selector de la página de inicio de sesión; la columna `ORG` permite distinguirlas.

**Cómo se mantienen las cuentas:**

* Cada cuenta tiene su propio `CLAUDE_CONFIG_DIR` dentro de `~/.config/wrapper-code/accounts/`. Claude Code guarda allí su inicio de sesión y, en macOS, también utiliza una entrada propia en Keychain.
* **Compartido con tu Claude Code habitual mediante un enlace simbólico:** todo lo que se encuentra en `~/.claude`, incluidos los ajustes, CLAUDE.md y los archivos que importa, plugins, skills, agentes, comandos y hooks. Los servidores MCP del usuario se copian desde `~/.claude.json` antes de cada sesión, al igual que la información de configuración inicial completada, para que una cuenta nueva llegue directamente al prompt. La confianza en las carpetas se solicita una vez por cuenta.
* **Específico de cada cuenta:** el inicio de sesión, el historial de sesiones y el estado de ejecución de Claude Code.

**Variables que anularían la cuenta:** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` y los indicadores de Bedrock, Vertex y Foundry se eliminan de estas sesiones. wrapper-code indica cuáles se han eliminado.

Los inicios de sesión de la consola realizados sin una API key se guardan fuera del directorio de configuración, en `~/.config/anthropic`, y se comparten entre todas las cuentas; por eso no son compatibles con este sistema.

## Dónde se almacenan los datos

Se utiliza un archivo por proveedor que contiene únicamente tus elecciones: la clave y el perfil de DeepSeek; para Ollama, el modelo, la instantánea del contexto y la URL base solo si es diferente de `http://localhost:11434`.

* macOS / Linux: `~/.config/wrapper-code/<provider>.env` (o `$XDG_CONFIG_HOME/wrapper-code/`), con permisos `600`.
* Windows: `%APPDATA%\wrapper-code\<provider>.env`

Los nombres de los modelos y las demás variables proceden del catálogo integrado cada vez que se inicia el programa. Por tanto, actualizar `wrapper-code` incorpora los cambios de los proveedores sin modificar tu archivo. Cualquier `KEY=value` adicional que añadas manualmente se conserva y prevalece sobre el catálogo.

## Cómo funciona

1. Lee la definición del proveedor (URL base, variables del modelo y método para comprobar una clave).
2. Lee tu archivo `<provider>.env`; inicia la página de configuración si falta la clave o el modelo.
3. Construye un entorno: variables de tu shell + variables del proveedor + variables del perfil (para Ollama, el modelo guardado dentro de las variables del modelo) + tu archivo. Se elimina `ANTHROPIC_API_KEY` para impedir que Claude Code vuelva a utilizar la autenticación de Anthropic.
4. Busca `claude` en tu `PATH` y lo ejecuta con ese entorno, reenviando sus argumentos y su código de salida.

Tu directorio global `~/.claude` (CLAUDE.md, skills, plugins, servidores MCP e historial) se comparte con la sesión del proveedor, ya que únicamente cambian las variables de entorno.

## Notas

* `~/.claude` se comparte, por lo que las entradas `env` de `~/.claude/settings.json` (y cualquier `apiKeyHelper`) también se aplican durante la sesión del proveedor y pueden anular sus variables. Si una sesión se conecta al backend equivocado, comprueba primero ese archivo.
* Ctrl+C se transmite a `claude`; el wrapper continúa ejecutándose hasta que `claude` termina.
* Si el archivo de un proveedor está dañado (por ejemplo, contiene una clave pegada sin formato), `wrapper-code setup <provider>` lo sustituye por uno nuevo.
* Antes de iniciar `claude`, wrapper-code muestra una pequeña animación de 8 bits que dura menos de un segundo. Solo aparece en terminales con color y al menos 72 columnas de ancho. Define `WRAPPER_CODE_NO_SPLASH=1` (o la variable estándar `NO_COLOR`) para desactivarla.

## Uso de tokens

Cada sesión registra localmente el uso de tokens. Cuando Claude Code termina, wrapper-code muestra un breve resumen con el número de solicitudes, los tokens (entrada, salida, lectura de caché y escritura de caché) y la duración de la sesión. No se estima el coste: los precios cambian con frecuencia y varían según el plan, por lo que debes consultar el panel de tu proveedor para saber cuánto has pagado realmente.

```bash
wrapper-code usage                 # últimos 30 días por proveedor y modelo
wrapper-code usage --since 7d --provider deepseek --by-day
wrapper-code usage --since all --json
wrapper-code usage clear           # eliminar todos los datos registrados (pide confirmación)
wrapper-code usage clear --provider deepseek --yes
```

`usage clear` elimina el uso registrado: todos los datos o solo los de un proveedor cuando se utiliza `--provider`. Muestra qué se eliminará y pide confirmación antes de hacerlo. `--yes` omite la confirmación y, si no hay terminal, es obligatorio. Esta acción no se puede deshacer.

Para registrar también el uso de tu Claude Code habitual, inícialo con `wrapper-code claude` en lugar de `claude`. La sesión no cambia; únicamente se registra su uso.

Los proveedores no contabilizan los tokens de entrada de la misma manera. La mayoría sigue la convención de Anthropic, en la que la entrada excluye los tokens leídos de la caché. Kimi Code (`kimi-code`) parece incluirlos: una sesión que lee 37.8k tokens de la caché también informa de unos 37k tokens de entrada, mientras que la API de Moonshot (`kimi`) informa de unos pocos cientos. El GLM Coding Plan de Z.ai (`zai-coding`) parece comportarse de forma similar: una sesión de una línea informa de 17.2k tokens de entrada, de los cuales 16.5k proceden de la caché. wrapper-code muestra las cifras comunicadas por cada proveedor; por tanto, para `kimi-code` y `zai-coding`, la columna de entrada sobreestima los tokens nuevos. La columna de lectura de caché es la referencia más fiable.

**Cómo funciona:** el wrapper inicia un pequeño receptor de OpenTelemetry en `127.0.0.1` durante la sesión y dirige hacia él la exportación de telemetría de Claude Code. Los recuentos de tokens son los que Claude Code comunica para cada solicitud a la API. Ningún dato sale de tu equipo; la información se guarda en `~/.config/wrapper-code/usage.jsonl` (modelo, tokens y duración por solicitud; no se guardan prompts ni respuestas). Define `WRAPPER_CODE_NO_USAGE=1` para desactivar esta función. Si tu shell ya define `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` o `CLAUDE_CODE_ENABLE_TELEMETRY`, wrapper-code conserva tu configuración y no registra datos para esa sesión. Mientras registra el uso, elimina cualquier variable `OTEL_EXPORTER_OTLP_LOGS_*` del entorno de la sesión para impedir que redirija la exportación. Las variables OTEL definidas en el archivo de configuración de Claude Code (el bloque `env` de `~/.claude/settings.json`) no se detectan; si exportas telemetría desde allí, define `WRAPPER_CODE_NO_USAGE=1`.

## Desarrollo

```bash
npm test
```

Las pruebas nunca llaman a una API real de ningún proveedor. Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para añadir un proveedor y revisar la lista de comprobación para pull requests.

## wrapper-code frente a claude-code-router

[claude-code-router](https://github.com/musistudio/claude-code-router) (CCR) es una gateway local que enruta, reescribe y reintenta cada solicitud de Claude Code y otros agentes. wrapper-code solo configura el entorno de una sesión y no interviene después: nada se interpone entre Claude Code y el proveedor, no hay procesos ejecutándose cuando no estás trabajando y `claude` permanece intacto. Si necesitas enrutamiento, alternativas o compatibilidad con otros agentes, utiliza CCR.

<details>
<summary><b>Leer la comparación completa</b></summary>

[claude-code-router](https://github.com/musistudio/claude-code-router) (CCR) es una de las opciones más conocidas para ejecutar Claude Code con otros modelos. Es una gateway local: un servicio en segundo plano en `127.0.0.1:3456` recibe todas las solicitudes de Claude Code (y de Codex, Kimi CLI, OpenCode y otros agentes), decide qué proveedor y modelo utilizar en cada solicitud y puede reescribirla, reintentarla, recurrir a otro modelo o clave, traducir a APIs de estilo OpenAI y Gemini, y añadir visión, búsqueda web o herramientas MCP a modelos que no las admiten. Incluye una interfaz de administración, registros de solicitudes con estimaciones de coste, una aplicación de escritorio e imágenes Docker. Si necesitas alguna de estas funciones, utiliza CCR.

wrapper-code pretende resolver un problema más pequeño: iniciar una sesión de Claude Code con un proveedor alternativo sin modificar tu Claude Code habitual ni ejecutar procesos adicionales. Configura `ANTHROPIC_BASE_URL`, la clave y las variables del modelo en el entorno de un único proceso `claude` y después no interviene. Ese es todo su diseño y de ahí proceden sus ventajas:

* **Nada entre Claude Code y el modelo.** Las solicitudes van directamente al endpoint del proveedor. No hay un proceso local que analice, reescriba y vuelva a transmitir cada solicitud y respuesta, ni un servicio adicional que pueda fallar. La documentación de CCR establece que su servicio debe estar ejecutándose para iniciar Claude Code desde él.
* **Tus prompts permanecen entre Claude Code y el proveedor.** wrapper-code nunca los ve; solo recibe los recuentos de tokens de Claude Code a través de un puerto local con un token aleatorio por sesión. La gateway de CCR ve todas las solicitudes y sus registros pueden almacenar los cuerpos de las solicitudes y respuestas (configurable: todo, solo errores o ninguno; se conservan durante el día actual).
* **Nada se ejecuta cuando no estás trabajando.** No hay demonios, aplicaciones de escritorio, bases de datos ni puertos abiertos. Cuando termina `claude`, wrapper-code muestra el resumen de uso y también termina.
* **No se puede redirigir tu `claude` habitual.** No se escribe nada en `~/.claude` y no existe un modo de configuración predeterminado del sistema que pueda hacer que tu Claude Code habitual se comunique con otro backend. CCR sí tiene un ámbito de ese tipo; su guía recomienda comenzar con «solo abierto desde CCR» por la misma razón.
* **Sesiones simultáneas.** Cada sesión tiene su propio entorno, por lo que `wrapper-code deepseek`, `wrapper-code ollama` y `claude` pueden ejecutarse al mismo tiempo en tres terminales.
* **Integración original del proveedor.** Cada definición sigue la configuración publicada por el proveedor para Claude Code (enlazada en la tabla de proveedores). Claude Code recibe lo que envía el endpoint: streaming, llamadas a herramientas, caché y razonamiento según la implementación del proveedor, sin una capa de traducción intermedia.
* **Pequeño y fácil de leer.** Un paquete npm sin dependencias de ejecución (27 archivos, aproximadamente 100 kB, Node.js 18+). Toda la configuración se encuentra en un archivo de entorno por proveedor que puedes consultar con `cat`; si exportas manualmente las mismas variables, obtendrás la misma sesión, con o sin wrapper-code.

Lo que wrapper-code no hace por diseño: enrutamiento por solicitud, alternativas, reintentos, rotación de claves, varios proveedores en una misma sesión, traducción de protocolos (el proveedor debe admitir la API Anthropic Messages) ni compatibilidad con agentes distintos de Claude Code. Esto refleja CCR 3.1 y su documentación de septiembre de 2026; consulta su repositorio para conocer el estado actual.

Ambos pueden instalarse al mismo tiempo. wrapper-code no conoce CCR; si un perfil de CCR está configurado como «predeterminado del sistema», comprueba que no haya añadido `ANTHROPIC_BASE_URL` al bloque `env` de `~/.claude/settings.json`, ya que los valores de ese archivo prevalecen sobre las variables configuradas por wrapper-code (consulta Notas).

</details>

## Autor

Creado por **Gabriel Fernandes** ([CD2](https://cd2.com.br)).

* Correo electrónico: [gabriel@cd2.com.br](mailto:gabriel@cd2.com.br)
* GitHub: [@nayamonia](https://github.com/nayamonia)
* Web: [cd2.com.br](https://cd2.com.br)

## Licencia

[MIT](LICENSE) © 2026 Gabriel Fernandes
