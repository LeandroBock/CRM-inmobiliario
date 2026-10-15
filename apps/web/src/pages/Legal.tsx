import type { CSSProperties, ReactNode } from 'react';
import { colors } from '../styles';

/**
 * Términos y Política de privacidad: páginas públicas (sin login) que piden TikTok y Meta al registrar las apps.
 * El nombre y el email de contacto salen de VITE_AGENCY_NAME y VITE_LEGAL_EMAIL (se definen al construir la web).
 * Es un modelo general: conviene que lo revise un abogado antes de usarlo con clientes.
 */
const AGENCY = import.meta.env.VITE_AGENCY_NAME?.trim() || 'la inmobiliaria';
const EMAIL = import.meta.env.VITE_LEGAL_EMAIL?.trim();
const UPDATED = '15 de octubre de 2026';

const contact = EMAIL ? (
  <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
) : (
  'los canales de contacto de la inmobiliaria'
);

export type LegalPage = 'privacidad' | 'terminos';

export function legalPageFromPath(pathname: string): LegalPage | null {
  const p = pathname.replace(/\/+$/, '').toLowerCase();
  if (p === '/privacidad') return 'privacidad';
  if (p === '/terminos') return 'terminos';
  return null;
}

export default function Legal({ page }: { page: LegalPage }) {
  return (
    <main style={wrap}>
      <nav style={{ fontSize: 14, marginBottom: 24 }}>
        <a href="/privacidad">Política de privacidad</a> · <a href="/terminos">Términos y condiciones</a>
      </nav>
      {page === 'privacidad' ? <Privacy /> : <Terms />}
      <p style={{ color: colors.muted, fontSize: 13, marginTop: 32 }}>Última actualización: {UPDATED}.</p>
    </main>
  );
}

function Privacy() {
  return (
    <>
      <h1>Política de privacidad</h1>
      <p>
        Esta política explica qué datos personales trata {AGENCY} a través de su sistema de gestión de clientes (CRM) y de sus cuentas en redes
        sociales, para qué los usa y qué derechos tenés. Se rige por la Ley 25.326 de Protección de los Datos Personales de la República Argentina.
      </p>
      <Section title="Qué datos recopilamos">
        <ul>
          <li>Datos de contacto que nos das: nombre, teléfono, email.</li>
          <li>Los mensajes que nos enviás por WhatsApp u otros canales, incluidos audios, fotos y ubicaciones que decidas compartir.</li>
          <li>Lo que buscás: operación, zonas, presupuesto, características de la propiedad y visitas agendadas.</li>
          <li>Para el personal de la inmobiliaria: nombre, email y registro de actividad dentro del CRM.</li>
        </ul>
      </Section>
      <Section title="Para qué los usamos">
        <ul>
          <li>Responder tus consultas, ofrecerte propiedades que coincidan con lo que buscás y coordinar visitas.</li>
          <li>Hacer seguimiento comercial de tu consulta.</li>
          <li>Publicar propiedades en nuestras propias cuentas de redes sociales.</li>
        </ul>
        <p>No vendemos ni cedemos tus datos a terceros para publicidad.</p>
      </Section>
      <Section title="Redes sociales (Facebook, Instagram y TikTok)">
        <p>
          El CRM se conecta a las cuentas de la inmobiliaria en Facebook, Instagram y TikTok únicamente para publicar contenido propio (fotos y videos de
          propiedades) y mostrar el nombre de la cuenta conectada. De TikTok usamos solo la información básica de la cuenta de la inmobiliaria
          (nombre de usuario y foto) y el permiso para publicar videos. No accedemos a datos de seguidores ni de otras personas. Los permisos de acceso se
          guardan cifrados y se pueden revocar en cualquier momento desde la configuración de cada red.
        </p>
      </Section>
      <Section title="Proveedores que usamos">
        <p>
          Para funcionar, el CRM usa servicios de terceros que procesan datos por cuenta nuestra: alojamiento y base de datos (Render, Supabase),
          mensajería (WhatsApp de Meta), y, si están activados, herramientas de inteligencia artificial para redactar respuestas, transcribir audios o
          editar fotos (Anthropic, OpenAI, Cloudflare). Algunos de estos servicios están fuera de la Argentina.
        </p>
      </Section>
      <Section title="Cuánto tiempo los guardamos">
        <p>Mientras tu consulta esté activa y luego el tiempo necesario para cumplir obligaciones legales. Podés pedir que los borremos antes.</p>
      </Section>
      <Section title="Tus derechos">
        <p>
          Podés pedir acceso, rectificación, actualización o supresión de tus datos escribiendo a {contact}. Respondemos dentro de los plazos de la Ley
          25.326 (10 días corridos para el acceso, 5 días hábiles para rectificar o suprimir). La Agencia de Acceso a la Información Pública, órgano de
          control de la Ley 25.326, atiende las denuncias y reclamos por incumplimiento de las normas de protección de datos personales.
        </p>
      </Section>
      <Section title="Seguridad">
        <p>Usamos conexiones cifradas, contraseñas protegidas, accesos por usuario y copias de seguridad diarias.</p>
      </Section>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Términos y condiciones</h1>
      <p>
        Estos términos rigen el uso del sistema de gestión (CRM) de {AGENCY} y de los canales por los que nos contactás. Al escribirnos o usar el
        sistema, los aceptás.
      </p>
      <Section title="El servicio">
        <p>
          {AGENCY} usa el CRM para atender consultas sobre propiedades, coordinar visitas y publicar propiedades en redes sociales. El acceso al CRM es
          solo para personal autorizado de la inmobiliaria.
        </p>
      </Section>
      <Section title="Información de las propiedades">
        <p>
          Los datos, precios y fotos de las propiedades son informativos y pueden cambiar sin aviso. No constituyen una oferta vinculante. Las imágenes
          marcadas como "Imagen ilustrativa" fueron editadas (por ejemplo, con amoblamiento virtual) y no muestran el estado actual del inmueble.
          Las tasaciones y estimaciones de valor son orientativas.
        </p>
      </Section>
      <Section title="Respuestas automáticas">
        <p>
          Algunas respuestas por WhatsApp pueden ser generadas por un asistente automático. En cualquier momento podés pedir hablar con una persona del
          equipo.
        </p>
      </Section>
      <Section title="Redes sociales">
        <p>
          Las publicaciones en Facebook, Instagram y TikTok se hacen en las cuentas propias de la inmobiliaria y cumplen las condiciones de cada
          plataforma. El uso de esas plataformas se rige además por sus propios términos.
        </p>
      </Section>
      <Section title="Uso aceptable">
        <p>No está permitido usar nuestros canales para enviar contenido ilegal, ofensivo o publicidad no solicitada.</p>
      </Section>
      <Section title="Responsabilidad">
        <p>
          Hacemos lo posible para que el servicio funcione sin interrupciones, pero puede haber fallas o demoras de los proveedores (por ejemplo,
          WhatsApp o las redes sociales) que no dependen de nosotros.
        </p>
      </Section>
      <Section title="Datos personales">
        <p>
          El tratamiento de tus datos se explica en la <a href="/privacidad">Política de privacidad</a>.
        </p>
      </Section>
      <Section title="Contacto y ley aplicable">
        <p>Por consultas sobre estos términos, escribinos a {contact}. Se aplican las leyes de la República Argentina.</p>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 style={{ fontSize: 18, marginTop: 28 }}>{title}</h2>
      {children}
    </section>
  );
}

const wrap: CSSProperties = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', maxWidth: 760, margin: '0 auto', padding: '32px 20px 48px', lineHeight: 1.6, fontSize: 15, color: '#1f2937' };
