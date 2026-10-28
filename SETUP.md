# Configurar AIMA

El sitio ya está publicado. Las cuentas no funcionan hasta completar estos pasos en Supabase. La clave que pega el navegador es pública: usa solo la clave **anon**. No pegues nunca la clave **service_role**.

Los depósitos **no están habilitados**. El formulario solo guarda una intención con estado `pendiente`. No hay pasarela, no hay monedero y no hay promesa de rendimiento.

`terminos.html` y `privacidad.html` son un **borrador pendiente de revisión legal**. No sustituyen el criterio de un abogado. Antes de darlos por cerrados, sustituye el párrafo de contacto.

## 1. Crear el proyecto

1. Entra en [supabase.com](https://supabase.com) y crea un proyecto gratis.
2. Elige y anota la región: los datos de cuenta pueden quedar fuera de la República Dominicana. La página de privacidad ya lo dice.
3. Espera a que el proyecto termine de crearse.

## 2. Crear las tablas

1. Abre **SQL Editor → New query**.
2. Pega todo el archivo `supabase/schema.sql` del repositorio.
3. Ejecútalo. Tiene que terminar sin errores.
4. En **Table Editor** deben aparecer `profiles`, `deposit_requests` y `announcements`.

Ese SQL crea el identificador `AIMA-XXXXXXXX`, guarda `terms_accepted_at` y `terms_version`, y activa RLS: cada persona lee y edita solo su fila. Una cuenta con `is_admin` puede ver las intenciones y cambiar su estado (`pendiente`, `en_revision`, `archivada`). Cambiar el estado no mueve dinero.

## 3. Pegar URL y clave anon

1. En Supabase abre **Project Settings → API**.
2. Copia **Project URL** y la clave **anon public**.
3. En el repositorio edita `config.js`:

```javascript
window.AIMA_CONFIG = {
  url: "https://xxxxxxxx.supabase.co",
  anonKey: "eyJ...la-clave-anon..."
};
```

4. Guarda, haz commit y espera el deploy de GitHub Pages. `config.js` viaja con el sitio. La clave anon está hecha para eso. La **service_role** no.

Si la clave pegada es la service_role, el sitio se niega a arrancar.

## 4. URLs de autenticación

En **Authentication → URL Configuration**:

- **Site URL:** `https://elliamherrera.github.io/aima/`
- **Redirect URLs,** una por línea:

```
https://elliamherrera.github.io/aima/**
https://elliamherrera.github.io/aima/restablecer.html
https://elliamherrera.github.io/aima/panel.html
https://elliamherrera.github.io/aima/login.html
```

## 5. Confirmación de correo (opcional para probar)

En **Authentication → Sign In / Providers → Email** puedes desactivar **Confirm email**.

- Desactivada: al registrarte entras directo al panel.
- Activada: la persona debe abrir el enlace del correo. El perfil y la aceptación de términos igual se guardan al crear el usuario, porque el trigger `handle_new_user` corre en la base.

Conviene subir la longitud mínima de contraseña a 8 en la configuración de Auth. El formulario ya exige 8 caracteres.

## 6. Probar el recorrido

1. Abre `https://elliamherrera.github.io/aima/registro.html`.
2. Crea una cuenta. Sin la casilla de Términos y Condiciones el alta no sale.
3. En el panel deben verse tu nombre, tu correo y un ID `AIMA-XXXXXXXX`.
4. En Depósitos, registra una intención. El aviso amarillo debe seguir diciendo que AIMA no recibe dinero. El historial muestra estado **Pendiente**.
5. En Ajustes cambia el nombre y la contraseña. Los campos de documento son opcionales y no suben archivos.
6. Cierra sesión y vuelve a entrar desde Iniciar sesión.
7. Prueba **¿Olvidaste tu contraseña?** y abre el enlace en el mismo navegador.

## 7. Hacerte administrador

Cuando tu usuario ya exista, en el SQL Editor:

```sql
update public.profiles
set is_admin = true
where email = 'tu-correo@ejemplo.com';
```

Recarga el sitio. Aparece **Admin**. Desde ahí puedes cambiar el estado de una intención y publicar un aviso. Ninguna de las dos cosas cobra ni promete una ganancia. La API no deja que una cuenta se ponga `is_admin` sola; solo este SQL, con el rol de la base.

## 8. Contacto de los textos legales

En `terminos.html` y `privacidad.html`, sustituye el párrafo que dice que el correo está pendiente por un correo real del responsable. Mantén el aviso de borrador hasta que alguien con criterio legal lo revise. La versión que guarda el registro es `2026-10-28-borrador`. Si cambias los términos de fondo, cambia también `TERMS_VERSION` en `app.js` y el texto de la versión en `registro.html` y `terminos.html`.
