# App de reservas de canchas (varias canchas, una sola base)

Dos páginas que comparten la misma base de datos (Supabase):

- `index.html`: la web pública donde los clientes ven las horas libres y reservan.
- `admin.html`: el panel del administrador (se instala en el celular como app).

## Puesta en marcha (una sola vez)

1. **Supabase**: crea un proyecto en supabase.com (región South America, São Paulo).
2. En **SQL Editor > New query**, pega todo `supabase/schema.sql` y pulsa **Run**.
3. En **Authentication > Users > Add user**, crea la cuenta del administrador (correo y contraseña, marca "Auto confirm").
4. Vuelve al **SQL Editor** y ejecuta, cambiando el correo:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'correo-del-admin@ejemplo.com';
   ```
5. En **Project Settings > API** copia la *Project URL* y la *anon public key* en `config.js`.
6. Publica la carpeta (GitHub Pages, Netlify o Vercel). El enlace para clientes es la raíz del sitio; el panel está en `/admin.html`.

## Cómo funciona

- Una sola reserva activa por hora (lo garantiza la base de datos).
- Los clientes nunca ven cédulas ni celulares de otros: solo ven qué horas están libres, por confirmar u ocupadas.
- "Pagar ahora" sube la foto del comprobante a un espacio privado que solo ve el administrador; la hora queda "por confirmar" hasta que el admin la confirme.
- "Pagar en la cancha" confirma la hora al instante; el admin marca "Cobré" al recibir el efectivo.
- Ajustes del panel: precio, exigir pago al reservar, horario, WhatsApp de la cancha, datos de transferencia y QR de Jardín Azuayo y DeUna.
- Límite contra abusos: máximo 3 reservas activas futuras por cédula.

## Varias canchas (desde el paso 6)

- Ejecuta `supabase/06-multi-cancha.sql`. Todo lo existente queda en "Canchas del Vecino" (la cancha principal).
- Administrador general: `insert into public.admins (user_id, is_super) select id, true from auth.users where email = 'TU-CORREO' on conflict (user_id) do update set is_super = true;`
- En el panel, la pestaña "Todas las canchas" (solo el administrador general) crea canchas, da acceso a sus administradores y muestra el resumen.
- Enlace de clientes de cada cancha: `https://canchas-vecino.github.io/?c=enlace-corto`. Sin `?c=` abre la cancha principal (el afiche sigue sirviendo).
- Cada administrador de cancha solo ve sus reservas, precios, ajustes, comprobantes y avisos.
