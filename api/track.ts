// POST /api/track — one batch of a play session: who, what happened (events), where (route samples), how far (progress).
import { sql, schema, json } from './_db.js';

export async function POST(req: Request) {
  if (!sql) return json({ error: 'no database' }, 503);
  let b: any;
  try {
    const text = await req.text();
    if (text.length > 256_000) return json({ error: 'too big' }, 413);
    b = JSON.parse(text);
  } catch { return json({ error: 'bad json' }, 400); }
  const id = String(b?.id ?? '');
  if (!/^[\w-]{8,64}$/.test(id)) return json({ error: 'bad id' }, 400);
  const name = String(b?.name ?? 'Anónimo').trim().slice(0, 40) || 'Anónimo';
  const ev = (Array.isArray(b?.ev) ? b.ev : []).slice(0, 600).filter((e: any) => e && typeof e.type === 'string' && Number.isFinite(e.t));
  const track = (Array.isArray(b?.track) ? b.track : []).slice(0, 600);
  const progress = b?.progress && typeof b.progress === 'object' && !Array.isArray(b.progress) ? b.progress : {};
  const start = ev.find((e: any) => e.type === 'start');
  try {
    await schema();
    await sql`insert into rn_sessions (id, name, device, progress, ended, batches)
      values (${id}, ${name}, ${start ? JSON.stringify(start.data ?? {}) : null}::jsonb, ${JSON.stringify(progress)}::jsonb, ${!!progress.ended}, 1)
      on conflict (id) do update set last_at = now(), progress = rn_sessions.progress || excluded.progress,
        ended = rn_sessions.ended or excluded.ended, batches = rn_sessions.batches + 1, device = coalesce(rn_sessions.device, excluded.device)`;
    if (ev.length) await sql`insert into rn_events (session, t, type, data)
      select ${id}, (e->>'t')::real, left(e->>'type', 24), e->'data' from jsonb_array_elements(${JSON.stringify(ev)}::jsonb) e`;
    if (track.length) await sql`insert into rn_track (session, seq, points) values (${id}, ${Number(b.seq) | 0}, ${JSON.stringify(track)}::jsonb)`;
  } catch (e) { return json({ error: String(e).slice(0, 200) }, 500); }
  return new Response(null, { status: 204 });
}
