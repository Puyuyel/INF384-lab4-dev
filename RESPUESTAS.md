# Respuestas · Laboratorio 4
Alumno: 20220293
Presupuesto: [8] min  Métrica DORA: [time to restore]

## Parte 1 · Diagnóstico
### Defecto 1
- Job y etapa: `smoke`, en la etapa deploy (`needs: build-push`, al mismo nivel que `deploy`). Debe estar en post-deploy.
- Problema que causa en el pipeline: smoke arranca en paralelo con deploy y encuentra la Function URL del despliegue anterior, así que valida la versión previa y pasa en verde aunque la nueva versión no arranque. Como `e2e` y `load` dependen de smoke, también terminan probando una versión que no es la del commit. Además no verificaba qué versión responde, aunque `smoke.sh` ya soporta `EXPECTED_COMMIT`. Deja pasar un despliegue roto.
- Link al commit: https://github.com/Puyuyel/INF384-lab4-dev/commit/7cd505e
- Corrección (una o más: mover de etapa / dejar como informativo / eliminar / ajustar configuración / modificar tests): mover de etapa (`needs: deploy`) + ajustar configuración (`EXPECTED_COMMIT: ${{ github.sha }}`).
- Evidencia (dato observado, con link al run o fragmento de la salida local): en el run https://github.com/Puyuyel/INF384-lab4-dev/actions/runs/40958511711 smoke corre después de deploy (grafo del run) y su log muestra `commit: 5e102a20036d9a8e89b1314643a1889c5fdf13ab`, que es el SHA del commit del run. Con `EXPECTED_COMMIT` el job solo pasa si `/version` devuelve ese commit.

### Defecto 2
- Job y etapa: `integration`, etapa pre-build.
- Problema que causa en el pipeline: las pruebas están encadenadas (cada una depende de los saldos que dejó la anterior) y comparten un archivo fijo `/tmp/wallet.db`. El resultado depende del orden de ejecución y de que la base empiece vacía: una prueba ejecutada sola falla, y la suite falla si la base ya tiene datos. Prueba de forma incorrecta porque no es aislada ni repetible.
- Link al commit: https://github.com/Puyuyel/INF384-lab4-dev/commit/c887f6f
- Corrección (una o más: mover de etapa / dejar como informativo / eliminar / ajustar configuración / modificar tests): modificar tests (base temporal propia por prueba en `beforeEach`, cada prueba prepara sus datos) + ajustar configuración (se quita `DB_PATH` fijo del job).
- Evidencia (dato observado, con link al run o fragmento de la salida local): antes de la corrección, una prueba ejecutada sola sobre base limpia falla porque depende de la transferencia que hacía la prueba anterior:
  ```
  $ DB_PATH=/tmp/wallet.db node --test --test-name-pattern="el saldo de ana refleja el debito" test/integration/transferir.test.js
  ✖ el saldo de ana refleja el debito (10.819071ms)
    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    + actual - expected
      {
    +   saldo: 1000,
    -   saldo: 900,
        usuario: 'ana'
      }
  ℹ pass 0
  ℹ fail 1
  ```
  Después de la corrección, el mismo comando:
  ```
  ✔ el saldo de ana refleja el debito (8.389072ms)
  ℹ pass 1
  ℹ fail 0
  ```

### Defecto 3
- Job y etapa: `sca`, etapa pre-build.
- Problema que causa en el pipeline: Trivy analiza con `--include-dev-deps` el árbol completo, incluidas las dependencias de desarrollo (Playwright, c8, esbuild), que no viajan en la imagen porque el Dockerfile hace `npm prune --omit=dev`. Una vulnerabilidad HIGH/CRITICAL en una herramienta de pruebas detiene el pipeline sin riesgo real para lo que se despliega: genera falsos positivos bloqueantes.
- Link al commit: https://github.com/Puyuyel/INF384-lab4-dev/commit/70f408b
- Corrección (una o más: mover de etapa / dejar como informativo / eliminar / ajustar configuración / modificar tests): ajustar configuración (quitar `--include-dev-deps`).
- Evidencia (dato observado, con link al run o fragmento de la salida local): del lock file, 84 de los 122 paquetes que Trivy analizaba son de desarrollo y no llegan a la imagen; solo 38 son de producción:
  ```
  $ node -e 'const p=require("./package-lock.json").packages;const k=Object.keys(p).filter(Boolean);console.log("total",k.length,"dev",k.filter(x=>p[x].dev).length,"prod",k.filter(x=>!p[x].dev).length)'
  total 122 dev 84 prod 38
  ```

### Defecto 4
- Job y etapa: `load`, etapa post-deploy.
- Problema que causa en el pipeline: la prueba de carga corría en cada push de cada pull request y consumía más de 12 minutos (1 m de rampa, 10 m constantes, 1 m de bajada) más tráfico real sobre la función. Una prueba de carga no corre en cada commit: corre antes de promover (en main). Desperdicia tiempo en cada PR.
- Link al commit: https://github.com/Puyuyel/INF384-lab4-dev/commit/b2e60c2
- Corrección (una o más: mover de etapa / dejar como informativo / eliminar / ajustar configuración / modificar tests): ajustar configuración (`if: github.event_name != 'pull_request'`; la prueba pasa a correr solo en main).
- Evidencia (dato observado, con link al run o fragmento de la salida local): en el run del pull request #2 (https://github.com/Puyuyel/INF384-lab4-dev/actions/runs/40960980080) todos los jobs hasta `e2e` terminan en verde y `load` aparece como skipped, con 0 s; en el run de main https://github.com/Puyuyel/INF384-lab4-dev/actions/runs/40960995491 `load` sí corre (4m 21s).

### Defecto 5
- Job y etapa: `load`, etapa post-deploy.
- Problema que causa en el pipeline: `http.expectedStatuses(200, 400)` y el check `transferir 200 o 400` trataban un 400 como respuesta exitosa. Si un defecto hace que `/transferir` rechace todas las transferencias, la tasa de error queda en 0 % y el check pasa; además la latencia medida sería la de un rechazo sin escritura en la base. Deja pasar una regresión y mide mal el SLO.
- Link al commit: https://github.com/Puyuyel/INF384-lab4-dev/commit/5e102a2
- Corrección (una o más: mover de etapa / dejar como informativo / eliminar / ajustar configuración / modificar tests): modificar tests (solo 200 es éxito en `/transferir`; un 400 cuenta en `http_req_failed`).
- Evidencia (dato observado, con link al run o fragmento de la salida local): en el run https://github.com/Puyuyel/INF384-lab4-dev/actions/runs/40958511711 el resumen de k6 evalúa el nuevo check y cuenta toda transferencia no 200 como fallo:
  ```
  ✓ transferir 200
  ✓ saldo 200
  http_req_failed................: 0.00%  0 out of 36072
  ```

## Parte 2 · Implementación
- Link al run en verde en main: https://github.com/Puyuyel/INF384-lab4-dev/actions/runs/40958511711
- Link al pull request: https://github.com/Puyuyel/INF384-lab4-dev/pull/1
- Defecto de la aplicación introducido (archivo y descripción): `src/wallet.js`, en `transferir` la validación de saldo pasa de `cuentaOrigen.saldo < centimos` a `cuentaOrigen.saldo <= centimos`. Transferir exactamente todo el saldo devuelve 400 "saldo insuficiente" en lugar de 200, y el usuario no puede vaciar su cuenta.
- Job que debería detenerlo: `unit` (prueba "transferir todo el saldo deja el origen en cero"). Es la prueba más barata que lo detecta, en pre-build y en milisegundos; `integration` también lo detecta ("diego transfiere todo su saldo a elena").
- Link al run fallido: https://github.com/Puyuyel/INF384-lab4-dev/actions/runs/40959420776

## Parte 3 · Decisión bajo restricción
Link al run medido: https://github.com/Puyuyel/INF384-lab4-dev/actions/runs/40958511711

| Job | Duración (min:seg) |
|---|---|
| unit | 0:14 |
| integration | 0:11 |
| sast | 0:21 |
| sca | 0:21 |
| build-push | 0:47 |
| deploy | 0:19 |
| smoke | 0:11 |
| e2e | 0:42 |
| load | 12:11 |
| **Total** | **15:17** |

Resultado de load en ese run:
| Métrica | Valor |
|---|---|
| p90 | 55.26 ms |
| p95 | 57.82 ms |
| Máximo | 280.26 ms |
| Tasa de error | 0.00 % (0 de 36072) |
| Requests por segundo | 50.08 req/s |

Conclusión sobre el comportamiento bajo carga: con 30 usuarios virtuales sostenidos durante 10 minutos, Monedero Andino responde de forma estable. La mediana es de 49 ms y el p95 de 58 ms, muy por debajo del umbral de 500 ms; la distancia entre p90 y p95 es de solo 2,5 ms, así que no hay una cola lenta relevante. El máximo de 280 ms es un caso aislado, compatible con el arranque en frío de nuevas instancias de Lambda. No hubo errores en 36 072 requests y el throughput se mantuvo en ~50 req/s (el máximo que generan 30 VUs con 2 requests y 1 s de pausa por iteración), así que esta carga no satura el servicio.

SLO propuesto (percentil, valor, ventana) y justificación: el 95 % de los requests a la API (`/transferir` y `/saldo`) responde en menos de **150 ms**, medido en una ventana móvil de 30 días en producción; en el pipeline se evalúa sobre la etapa de carga constante de cada run en main (`SLO_P95: 150`). Un valor cercano a lo medido (58 ms) haría fallar `load` por la variación normal entre runs y por los arranques en frío (máximo de 280 ms). 500 ms, en cambio, es casi 9 veces lo medido y dejaría pasar una regresión que triplique la latencia. 150 ms da unas 2,5 veces de margen sobre el p95 medido y sigue detectando degradaciones reales.

SLA propuesto y diferencia con el SLO: Monedero Andino se compromete con sus clientes a que, en cada mes calendario, el 99,5 % de los requests se respondan con éxito y el 95 % en menos de **500 ms**; si no se cumple, el cliente recibe un crédito o compensación. El SLO es un objetivo interno del equipo que guía decisiones (frenar despliegues, priorizar correcciones) y no tiene consecuencias contractuales; el SLA es un compromiso externo con penalidad. Por eso no tienen el mismo valor: el SLA es más holgado que el SLO para que el equipo vea el incumplimiento del SLO y reaccione antes de llegar a incumplir el contrato.

Cambios para cumplir el presupuesto:
| Cambio | Job | Minutos recuperados |
|---|---|---|
| Etapas de k6: rampa de 1 m → 10 s, carga constante de 10 m → 4 m (mínimo permitido), sin rampa de bajada | load | 7:50 (12:11 → 4:21) |
| Los pasos de sast solo corren en `pull_request`; en main el job no analiza (sigue bloqueando en los PR) | sast | 0:18 (0:21 → 0:03) |

Total resultante: 6:58 min (suma de jobs: 0:11 + 0:14 + 0:03 + 0:18 + 0:45 + 0:15 + 0:13 + 0:38 + 4:21)
Link al run en main con los cambios: https://github.com/Puyuyel/INF384-lab4-dev/actions/runs/40960995491

Riesgo aceptado (defecto de la aplicación concreto y efecto en la métrica DORA asignada): al reducir la carga constante de 10 a 4 minutos, el pipeline deja de detectar defectos que solo aparecen con carga sostenida. Ejemplo concreto: un cambio en `src/db.js` hace que `obtenerStore()` abra una conexión nueva a SQLite en cada request sin cerrar la anterior. Cada instancia de Lambda acumula descriptores de archivo y memoria; los primeros minutos responde bien y la prueba de 4 minutos pasa, pero con tráfico sostenido la instancia agota sus recursos y empieza a responder 500. Ese defecto llega a producción y se manifiesta como una degradación gradual, que tarda en detectarse y en diagnosticarse porque no está ligada a un despliegue reciente evidente. **Time to restore sube** para este tipo de incidente: el tiempo de detección y diagnóstico pesa más que lo que se ahorra en el pipeline. El pipeline más corto (6:58 en lugar de 15:17) acelera el redespliegue de la reversión, pero no compensa las horas de detección de una degradación lenta.

Decisión sobre sast (se queda / se mueve a otra etapa o evento / informativo) y razón: **se mueve al evento `pull_request`**. En el PR sigue bloqueando el merge si hay hallazgos ERROR, así que el código que llega a main por PR ya fue analizado; volver a analizarlo en main repite el mismo resultado sobre el mismo código. Costo: 0:21 en cada run de main; con el cambio pasa a 0:03 y recupera 0:18, que con un presupuesto de 8 minutos y el run en 6:58 es parte del margen frente a la variación entre runs. Efecto en time to restore: **baja levemente**, porque el despliegue de una corrección o reversión en main tarda ~18 s menos en pasar el pipeline. No se deja como informativo ni se elimina porque, como compuerta antes del merge, sigue evitando que un patrón inseguro llegue a producción, y ese incidente (con su tiempo de restauración) es mucho más caro que 21 s por PR. El riesgo restante es un push directo a main sin PR, que se cubre con protección de rama.

## Declaración de uso de IA
Herramientas usadas y para qué:
- Claude (Anthropic): para revisar `ci.yml`, `package.json` y `test/` contra el material del curso e identificar los cinco defectos, proponer y redactar las correcciones (los commits fueron preparados con su apoyo y aplicados y subidos por mí), preparar los comandos para obtener la evidencia, interpretar el resultado de k6, proponer el SLO, el SLA y los cambios para cumplir el presupuesto, y redactar las respuestas. Los comandos, los runs y la verificación de los resultados los ejecuté yo.