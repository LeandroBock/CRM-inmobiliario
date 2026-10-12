import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiFetch } from '../api/client';

type Stage = 'nuevo' | 'calificado' | 'visita_agendada' | 'negociacion' | 'cerrado';

interface FunnelStep {
  stage: Stage;
  count: number;
}

interface PostPerformance {
  id: string;
  platform: 'instagram' | 'facebook' | 'linkedin' | 'tiktok';
  copy: string;
  views: number;
  engagementRate: number; // 0-1
  clicks: number;
  publishedAt: string;
}

interface HotLead {
  id: string;
  fullName: string;
  leadScore: number;
  topMatch?: string;
}

interface DashboardData {
  funnel: FunnelStep[];
  posts: PostPerformance[];
  hotLeads: HotLead[];
  bestSlots: { label: string; platform: string }[];
}

const STAGE_LABEL: Record<Stage, string> = {
  nuevo: 'Nuevos (chat IA)',
  calificado: 'Calificados por IA',
  visita_agendada: 'Visita agendada',
  negociacion: 'Negociación',
  cerrado: 'Cerrados',
};

// Datos de muestra para ver el diseño mientras el backend no expone /dashboard
const MOCK: DashboardData = {
  funnel: [
    { stage: 'nuevo', count: 240 },
    { stage: 'calificado', count: 118 },
    { stage: 'visita_agendada', count: 54 },
    { stage: 'negociacion', count: 21 },
    { stage: 'cerrado', count: 9 },
  ],
  posts: [
    { id: '1', platform: 'instagram', copy: 'Oportunidad en Pichincha: USD 1.850/m²…', views: 5400, engagementRate: 0.067, clicks: 132, publishedAt: '2026-10-08T20:00:00-03:00' },
    { id: '2', platform: 'tiktok', copy: 'Recorrido 2 amb. en Echesortu', views: 12100, engagementRate: 0.041, clicks: 98, publishedAt: '2026-10-07T21:00:00-03:00' },
    { id: '3', platform: 'linkedin', copy: 'Dónde invertir en 2026 en Rosario', views: 1900, engagementRate: 0.052, clicks: 61, publishedAt: '2026-10-06T09:00:00-03:00' },
  ],
  hotLeads: [
    { id: 'a', fullName: 'Julieta M.', leadScore: 91, topMatch: 'Depto 3 amb. Pichincha' },
    { id: 'b', fullName: 'Martín R.', leadScore: 84, topMatch: 'Casa 4 amb. Fisherton' },
    { id: 'c', fullName: 'Carolina S.', leadScore: 76, topMatch: 'PH Echesortu' },
  ],
  bestSlots: [
    { label: 'Mar 20:00', platform: 'Instagram' },
    { label: 'Jue 21:00', platform: 'TikTok' },
    { label: 'Mié 09:00', platform: 'LinkedIn' },
  ],
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function Dashboard() {
  const [data, setData] = useState<DashboardData>(MOCK);
  const [isDemo, setIsDemo] = useState(true);

  useEffect(() => {
    apiFetch<DashboardData>('/dashboard')
      .then((d) => {
        setData(d);
        setIsDemo(false);
      })
      .catch(() => {
        // Si fue un 401, App cierra la sesión sola. Con cualquier otro error se muestra la maqueta, avisando.
        setData(MOCK);
        setIsDemo(true);
      });
  }, []);

  const max = useMemo(() => Math.max(...data.funnel.map((f) => f.count), 1), [data.funnel]);
  const conv = useMemo(() => {
    const first = data.funnel[0]?.count || 1;
    const last = data.funnel[data.funnel.length - 1]?.count || 0;
    return last / first;
  }, [data.funnel]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 4 }}>Panel</h1>
      {isDemo && (
        <p role="status" style={{ background: '#fff4e6', border: '1px solid #ffd8a8', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}>
          Mostrando datos de muestra: todavía no hay datos reales o no se pudo consultar la API.
        </p>
      )}
      <p style={{ marginTop: 0, color: '#667' }}>Conversión total lead → cierre: <strong>{pct(conv)}</strong></p>

      <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
        {/* Embudo de leads calificados por la IA */}
        <article style={card}>
          <h2 style={h2}>Embudo de leads</h2>
          {data.funnel.map((step, i) => {
            const prev = data.funnel[i - 1]?.count;
            return (
              <div key={step.stage} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span>{STAGE_LABEL[step.stage]}</span>
                  <span>
                    <strong>{step.count}</strong>
                    {prev ? <small style={{ color: '#667' }}> · {pct(step.count / prev)} del paso anterior</small> : null}
                  </span>
                </div>
                <div style={{ background: '#eef1f6', borderRadius: 6, height: 18 }}>
                  <div style={{ width: `${(step.count / max) * 100}%`, height: '100%', borderRadius: 6, background: '#2f5bea' }} />
                </div>
              </div>
            );
          })}
        </article>

        {/* Leads calientes con su mejor match */}
        <article style={card}>
          <h2 style={h2}>Leads calientes</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {data.hotLeads.map((l) => (
              <li key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #eef1f6' }}>
                <span>
                  {l.fullName}
                  <br />
                  <small style={{ color: '#667' }}>Match: {l.topMatch ?? '—'}</small>
                </span>
                <strong style={{ color: '#d9480f' }}>{l.leadScore}</strong>
              </li>
            ))}
          </ul>
        </article>
      </section>

      {/* Rendimiento de publicaciones */}
      <article style={{ ...card, marginTop: 24 }}>
        <h2 style={h2}>Rendimiento de publicaciones</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#667' }}>
              <th>Red</th><th>Publicación</th><th>Vistas</th><th>Engagement</th><th>Clicks</th>
            </tr>
          </thead>
          <tbody>
            {data.posts.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid #eef1f6' }}>
                <td style={{ padding: '8px 0', textTransform: 'capitalize' }}>{p.platform}</td>
                <td>{p.copy}</td>
                <td>{p.views.toLocaleString('es-AR')}</td>
                <td>{pct(p.engagementRate)}</td>
                <td>{p.clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: '#667', marginBottom: 0 }}>
          Mejores horarios sugeridos por la IA:{' '}
          {data.bestSlots.map((s) => `${s.platform} ${s.label}`).join(' · ')}
        </p>
      </article>
    </main>
  );
}

const card: CSSProperties = { background: '#fff', border: '1px solid #e3e7ef', borderRadius: 12, padding: 20 };
const h2: CSSProperties = { fontSize: 16, marginTop: 0 };
