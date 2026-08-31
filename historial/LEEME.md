# Historial de salud

Una línea por corrida de la vigilancia (`vigilancia.yml`), en JSON Lines.

Un informe suelto dice si la app está bien HOY. Cien informes dicen **qué se
está moviendo**: la cobertura que baja poco a poco, el ruido de los datos que
sube, la edad de los datos creciendo porque la actualización lleva días
fallando. Nada de eso se ve en una foto, y un umbral tampoco lo caza — un
umbral solo salta cuando ya es tarde.

Para mirarlo:

```sh
node scripts/tendencia.mjs            # lo que ha cambiado
node scripts/tendencia.mjs --todo     # todas las filas
```

Las cifras que guarda, y por qué cada una:

| campo | para qué |
|---|---|
| `fallos`, `avisos` | si la app publicada está sana |
| `edadHoras` | si la actualización automática sigue viva |
| `cruces`, `sinergias` | si la matriz sigue completa (17.556 cada una) |
| `cobertura` | qué parte de las decisiones se apoya en datos reales |
| `recorteCounters`, `recorteSinergias` | si las escalas siguen bien puestas |
| `ruido` | si el dato de los héroes poco jugados sigue siendo firme; sostiene `PICKRATE_FIABLE` |
| `pools` | héroes por línea; si uno se vacía, esa línea deja de servir |

No lleva NADA personal: son corridas automáticas contra lo publicado, sin móvil
y sin maestría. La maestría y las partidas de Javi no salen de su teléfono.
