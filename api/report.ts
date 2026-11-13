// GET /api/report?k=KEY → every session; &s=ID → one session with its events and its route.
// The key lives only in Vercel: Settings → Environment Variables → REPORT_KEY (it is never in the code).
import { sql, schema, json } from './_db.js';

const KEY = process.env.REPORT_KEY || '';

export async function GET(req: Request) {
  const u = new URL(req.url);
  if (!KEY) return json({ error: 'Falta la variable REPORT_KEY en Vercel (Settings → Environment Variables).' }, 503);
  if (u.searchParams.get('k') !== KEY) return json({ error: 'forbidden' }, 403);
  if (!sql) return json({ error: 'no database' }, 503);
  try {
    await schema();
    const s = u.searchParams.get('s');
    if (!s) {
      const sessions = await sql`select id, name, started_at, last_at, device, progress, ended,
        (select count(*)::int from rn_events e where e.session = r.id) as events from rn_sessions r order by started_at desc limit 500`;
      return json({ sessions });
    }
    const [session] = await sql`select * from rn_sessions where id = ${s}`;
    if (!session) return json({ error: 'not found' }, 404);
    const events = await sql`select t, type, data from rn_events where session = ${s} order by t, id`;
    const track = await sql`select points from rn_track where session = ${s} order by seq, id`;
    return json({ session, events, track: track.flatMap((r: any) => r.points) });
  } catch (e) { return json({ error: String(e).slice(0, 200) }, 500); }
}
