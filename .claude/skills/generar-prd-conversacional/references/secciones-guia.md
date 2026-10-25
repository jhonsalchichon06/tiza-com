# Guía de profundización por sección

Esta guía la usa el agente para **no improvisar** las preguntas de cada sección. Cada bloque
define: por qué importa, qué preguntar, qué alternativas ofrecer (cuando aplica), y
anti-patrones que el agente debe evitar.

---

## 1. Problema

**Por qué importa:** es la sección que define TODO lo demás. Si el problema está mal
enmarcado, el resto del PRD queda defendiendo algo que no es.

**Qué preguntar** (elegir 1-2, no las tres):

- ¿Qué hace hoy el usuario cuando tiene este problema? (contexto реаль)
- ¿Qué pierde — tiempo, plata, oportunidades, salud, tranquilidad — por no resolverlo?
- ¿Por qué **ahora**? ¿Qué cambió, o qué está a punto de cambiar, que vuelve esto urgente?

**Alternativas de encuadre** (presentar cuando el problema es vago):

| Encuadre | Cuándo sirve | Riesgo |
|---|---|---|
| **Dolor concreto** ("el usuario pierde X por Y") | Hay un costo medible hoy | Puede sonar chico si el dolor es percibido |
| **Oportunidad** ("el usuario podría ganar X si...") | El problema es aspiracional, no urgente | Más difícil de priorizar |
| **Necesidad regulatoria / compliance** ("hay que cumplir X") | Es驱动ada por normativa, no por usuario | PRD se vuelve sobre el "qué", no el "por qué" |

**Anti-patrones:**

- "Es un problema que todos tienen" → no es un problema, es un mercado. Pedir конкретный caso.
- "Mejora la experiencia" → vacío. Pedir qué改善 específicamente.
- "No hay solución buena en el mercado" → no es problema del usuario, es problema de mercado.

---

## 2. Usuario objetivo

**Por qué importa:** si el usuario es "todo el mundo", el producto no es para nadie.

**Qué preguntar:**

- ¿Quién es la persona concreta que va a usar esto? (rol, no demografía)
- ¿En qué momento del día / semana la usa? (contexto de uso)
- ¿Qué está haciendo justo antes y después? (trigger y outcome)
- ¿Qué herramienta usa **hoy** para resolver el problema? (incluso si es un Excel, un grupo
  de WhatsApp, o nada)

**Alternativas de segmentación** (presentar cuando hay duda):

| Enfoque | Cuándo sirve | Riesgo |
|---|---|---|
| **Un solo perfil detallado** | Producto inicial,早期 adopters | Puede dejar afuera el 80% del mercado |
| **2-3 perfiles primarios** | Producto con casos de uso distintos | Difícil decidir cuál priorizar si compiten |
| **Persona + anti-persona** | Equipo pequeño, foco claro | La anti-persona a veces se ignora |

**Anti-patrones:**

- "Usuarios de internet" / "personas de 25-45 años" → no es un usuario, es un segmento
  publicitario. Pedir конкретный rol.
- "Empresas" → todas las empresas no son usuario. ¿Qué tipo, qué tamaño, qué industria?

---

## 3. Objetivo / resultado esperado

**Por qué importa:** distingue "lo que el producto **hace**" (output) de "lo que el
usuario **logra**" (outcome). Un PRD confundido en esto termina midiendo features
implementadas, no valor entregado.

**Qué preguntar:**

- ¿Qué cambia en la vida/trabajo del usuario si esto funciona como se espera?
- ¿Cómo te das cuenta — el usuario, vos, los dos — de que está funcionando?
- ¿En cuánto tiempo debería verse ese cambio? (semana, mes, trimestre)

**Alternativas deoutcome** (presentar casi siempre — es la sección con más confusión):

| Outcome | Ejemplo | Cuándo sirve |
|---|---|---|
| **Comportamental** | El usuario vuelve 3 veces por semana | Producto de uso frecuente |
| **De tarea completada** | El usuario termina el流程 en <5 min | Producto de tarea puntual |
| **De métrica de negocio** | Conversión sube de X% a Y% | Producto de negocio con funnel |
| **De cualidad субъективa** | El usuario reporta "me siento más tranquilo" | Producto de bienestar/confianza |
| **Híbrido** | Las dos primeras juntas | Producto serio |

**Anti-patrones:**

- "El usuario puede hacer X" → eso es feature, no outcome. El outcome es lo que pasa
  **después** de hacer X.
- "Mejora la productividad" → sin número ni comparación, no es outcome. Pedir baseline.

---

## 4. Alcance

**Por qué importa:** esta sección es la que evita el clásico "se fue de alcance". Si el
alcance no está explícito, todo está en alcance — y nada se termina.

**Qué preguntar:**

- ¿Cuáles son las 3-5 funcionalidades **mínimas** sin las cuales el producto no sirve?
- ¿Hay algo que el usuario **espera** que esté, aunque no sea crítico? (diferenciar de "mínimo viable")
- ¿Hay dependencias externas (otro sistema, otro equipo, un proveedor) que condicionen el alcance?

**Alternativas de frontera** (presentar cuando hay presión de incluir más):

| Frontera | Cuándo sirve | Riesgo |
|---|---|---|
| **MVP funcional** (1 flujo completo end-to-end) | Producto nuevo, validar核心 | Puede sentirse "incompleto" |
| **MVP con extras mínimos** (1 flujo + features que el usuario espera) | Producto con expectativas claras | Extras总是 se vuelven críticos |
| **Vertical slice** (1 tipo de usuario, completo) | Producto multi-segmento | Deja afuera usuarios valiosos |

**Anti-patrones:**

- Listas de 20 bullets → no es alcance, es backlog. Si pasa de 7-8, hay que recortar.
- "Y también..." después de cerrar la lista → reabre el alcance. Marcar esos como "fuera de
  v1, ver roadmap".

---

## 5. No alcance

**Por qué importa:** esta sección es la que **defiende** al equipo. Sin ella, cualquier pedido
es "estaba en el PRD".

**Qué preguntar:**

- ¿Qué cosas **cercanas** al producto la gente va a предполагать que están y NO van a estar?
- ¿Qué features "fáciles de agregar" se dejaron fuera a propósito? ¿Por qué?
- ¿Hay integraciones obvias (con X, con Y) que **no** se hacen en esta versión?

**Anti-patrones:**

- "Todo lo no mencionado arriba" → no excluye nada, no sirve.
- Listas de features que "quizás algún día" → eso es roadmap, no no-alcance.
- "Nada que no esté en alcance" → tautología vacía. Pedir конкретный exclusiones.

**Buen patrón de respuesta** (para mostrar como ejemplo si el usuario está perdido):

```
- No incluye autenticación con redes sociales (solo email/password en v1)
- No incluye modo offline (requiere conexión)
- No incluye exportación a PDF (solo CSV)
- No incluye panel de administración (los datos se gestionan por otro sistema)
```

---

## 6. Criterios de éxito

**Por qué importa:** si no se puede medir, no se puede saber si el producto sirvió. Esta
sección es la que convierte un PRD en algo que se puede **evaluar** post-lanzamiento.

**Qué preguntar:**

- ¿Cuál es la **una** métrica que, si mejoró, te dice que el producto sirvió?
- ¿Cuánto tiene que mejorar para considerar que "funcionó"? (número concreto)
- ¿En qué ventana de tiempo? (semana 4 post-launch, fin de trimestre)
- ¿Qué métrica **NO** mirarías aunque esté disponible? (anti-métrica: engagement cuando
  querés resultados, vanidad cuando querés revenue, etc.)

**Alternativas de métrica** (presentar cuando hay duda):

| Tipo | Ejemplo | Cuándo sirve |
|---|---|---|
| **Activación** | % de nuevos usuarios que completan el flujo clave en 24h | Producto nuevo |
| **Retención** | % de usuarios que vuelven en la semana 2 | Producto de uso frecuente |
| **Conversión** | % de visitantes que completan la acción目标 | Producto con funnel |
| **Tiempo de tarea** | Mediana de tiempo para completar X | Producto de productividad |
| **NPS / satisfacción** | Score post-flujo | Producto de confianza/bienestar |
| **Adopción** | % de usuarios que usan la feature X | Producto con varias features |

**Anti-patrones:**

- "Que al usuario le guste" → sin medición, no es criterio.
- "Que sea rápido" → "rápido" no es medible. Pedir "responde en <200ms en el percentil 95".
- "Que sea intuitivo" → pedir tarea concreta completada sin ayuda.
- Mezclar métricas de **uso** con métricas de **valor**: son cosas distintas, no las pongas en
  la misma bolsa.

---

## 7. Casos borde

**Por qué importa:** los casos borde son donde se rompe un producto. Si no se piensan
después del PRD, se piensan en producción — más caro y más feo.

**Qué preguntar:**

- ¿Qué pasa si el usuario empieza el flujo y se va a la mitad?
- ¿Qué pasa si el usuario carga datos inválidos / vacíos / malformados?
- ¿Qué pasa si el sistema externo que el producto depende está caído?
- ¿Qué pasa si dos usuarios / dos sesiones hacen lo mismo al mismo tiempo?
- ¿Qué pasa si el usuario intenta algo que "no debería" pero que es posible? (atajos de URL,
  saltar pasos, etc.)

**Anti-patrones:**

- Solo "qué pasa si falla la red" → ese es uno, no el universo. Pensar también en datos,
  concurrencia, permisos.
- Listas de 20 items sin priorizar → pensar 3-5 críticos, el resto queda para diseño.

---

## 8. Supuestos y riesgos

**Por qué importa:** esta sección es la honestidad del PRD. Lo que el equipo **asume** que es
verdad y lo que **puede salir mal**. Si el PRD no tiene esto, está fingiendo que no hay
incertidumbre.

**Qué preguntar:**

- ¿Qué estás asumiendo del usuario que, si es falso, rompe el producto?
- ¿Qué estás asumiendo del mercado / contexto que, si cambia, invalida el alcance?
- ¿Qué riesgo técnico o de negocio es el que más te preocupa?
- ¿De qué depende este producto que está fuera de tu control? (otro equipo, proveedor,
  regulación)

**Anti-patrones:**

- Solo riesgos genéricos ("la competencia copia", "el mercado cambia") → no actionable.
- Solo supuestos técnicos ("asumimos que la API responde en <100ms") → también de negocio,
  usuario, mercado.

**Buen patrón de respuesta** (para mostrar como ejemplo):

```
Supuestos:
- Asumimos que el usuario ya tiene cuenta en [sistema externo] (validar en discovery)
- Asumimos que la red es estable en el contexto de uso (WiFi, no 3G en zonas rurales)

Riesgos:
- Si [sistema externo] cambia su API, hay que migrar en <X días
- Si la regulación de [tema] cambia en el trimestre, parte del alcance deja de ser válido
- Si el primer usuario no es el perfil esperado, hay que re-pivotar (asumido: 2 semanas
  máx para re-pivotar)
```
