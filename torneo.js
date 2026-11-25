// Lógica compartida de campeonatos: carga de datos, tabla de posiciones, goleadores, tarjetas y calendario.
// La usan el panel (admin-campeonatos.html) y la página pública (torneo.html).

const SERIES_NAMES = ["A", "B", "C", "D", "E", "F"];
const KIND_LABEL = { goal: "⚽ Gol", yellow: "🟨 Amarilla", red: "🟥 Roja" };

// Carga un torneo completo. admin = true trae también cédula, fecha de nacimiento y celular del técnico.
async function loadTournamentData(tid, admin = false) {
  const { data: t, error } = await sb.from("tournaments").select("*").eq("id", tid).maybeSingle();
  if (error) throw error;
  if (!t) return null;
  const { data: venue } = await sb.from("venues").select("*").eq("id", t.venue_id).maybeSingle();
  const { data: cats } = await sb.from("t_categories").select("*").eq("tournament_id", tid).order("sort").order("created_at");
  const catIds = (cats || []).map(c => c.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const ids = catIds.length ? catIds : none;
  const teamCols = admin ? "*" : "id,category_id,series_id,name,crest_url,coach_name,created_at";
  const playerCols = admin ? "*" : "id,team_id,name,number,photo_url,created_at";
  const [{ data: series }, { data: teams }, { data: matches }] = await Promise.all([
    sb.from("t_series").select("*").in("category_id", ids).order("name"),
    sb.from("t_teams").select(teamCols).in("category_id", ids).order("name"),
    sb.from("t_matches").select("*").in("category_id", ids).order("round", { nullsFirst: false }).order("match_date", { nullsFirst: false }).order("match_time").order("created_at"),
  ]);
  const teamIds = (teams || []).map(x => x.id), matchIds = (matches || []).map(x => x.id);
  const getPlayers = cols => sb.from("t_players").select(cols).in("team_id", teamIds.length ? teamIds : none).order("number", { nullsFirst: false }).order("name");
  const [{ data: players }, { data: events }] = await Promise.all([
    // Si aún no se ejecutó el paso 9 (fotos), se cargan los jugadores sin foto
    getPlayers(playerCols).then(r => (r.error && !admin ? getPlayers("id,team_id,name,number,created_at") : r)),
    sb.from("t_events").select("*").in("match_id", matchIds.length ? matchIds : none).order("minute", { nullsFirst: false }).order("created_at"),
  ]);
  return { t, venue, cats: cats || [], series: series || [], teams: teams || [], players: players || [], matches: matches || [], events: events || [] };
}

const byId = list => Object.fromEntries(list.map(x => [x.id, x]));

// Tabla de posiciones de un grupo de equipos (una serie o toda la categoría)
function standings(D, teamList, seriesId) {
  const rows = Object.fromEntries(teamList.map(t => [t.id, { team: t, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, dg: 0, pts: 0 }]));
  D.matches.filter(m => m.played && (seriesId === undefined || m.series_id === seriesId)).forEach(m => {
    const h = rows[m.home_id], a = rows[m.away_id]; if (!h || !a) return;
    h.pj++; a.pj++; h.gf += m.home_goals; h.gc += m.away_goals; a.gf += m.away_goals; a.gc += m.home_goals;
    if (m.home_goals > m.away_goals) { h.pg++; a.pp++; } else if (m.home_goals < m.away_goals) { a.pg++; h.pp++; } else { h.pe++; a.pe++; }
  });
  return Object.values(rows).map(r => ({ ...r, dg: r.gf - r.gc, pts: r.pg * D.t.points_win + r.pe * D.t.points_draw }))
    .sort((x, y) => y.pts - x.pts || y.dg - x.dg || y.gf - x.gf || x.team.name.localeCompare(y.team.name));
}

// Goles, amarillas y rojas por jugador dentro de una categoría
function playerStats(D, catId) {
  const teams = byId(D.teams.filter(t => t.category_id === catId)), players = byId(D.players);
  const catMatches = new Set(D.matches.filter(m => m.category_id === catId).map(m => m.id));
  const out = {};
  D.events.filter(e => catMatches.has(e.match_id) && e.player_id && players[e.player_id]).forEach(e => {
    const p = players[e.player_id];
    const r = out[p.id] || (out[p.id] = { player: p, team: teams[p.team_id], goal: 0, yellow: 0, red: 0 });
    r[e.kind]++;
  });
  return Object.values(out).filter(r => r.team);
}

// Calendario "todos contra todos" (método del círculo). Devuelve [[local, visitante], …] por fecha.
function roundRobin(ids) {
  const list = [...ids]; if (list.length < 2) return [];
  if (list.length % 2) list.push(null);
  const n = list.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a && b) games.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(games);
    list.splice(1, 0, list.pop());
  }
  return rounds;
}

function ageOn(birth, onIso) {
  if (!birth) return null;
  const [y, m, d] = birth.split("-").map(Number), [Y, M, Dd] = onIso.split("-").map(Number);
  return Y - y - (M < m || (M === m && Dd < d) ? 1 : 0);
}
function ageProblem(cat, player) {
  const age = ageOn(player.birth_date, nowEc().date);
  if (age === null) return "";
  if (cat.min_age != null && age < cat.min_age) return `Tiene ${age} años: menos de ${cat.min_age}`;
  if (cat.max_age != null && age > cat.max_age) return `Tiene ${age} años: más de ${cat.max_age}`;
  return "";
}
function ageRuleText(cat) {
  if (cat.min_age != null && cat.max_age != null) return `De ${cat.min_age} a ${cat.max_age} años`;
  if (cat.max_age != null) return `Hasta ${cat.max_age} años`;
  if (cat.min_age != null) return `Desde ${cat.min_age} años`;
  return "";
}

// Escudo del equipo, o sus iniciales si no tiene
function crestHtml(team, size = 32) {
  if (!team) return "";
  if (team.crest_url) return `<img class="crest" src="${esc(team.crest_url)}" alt="" style="width:${size}px;height:${size}px">`;
  const ini = team.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  return `<span class="crest crest-ini" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .4)}px">${esc(ini)}</span>`;
}
function matchWhen(m) {
  const d = m.match_date ? dayLabel(m.match_date) : "";
  return [m.round ? `Fecha ${m.round}` : m.phase, d, m.match_time].filter(Boolean).join(" · ");
}
function torneoLink(tid, teamId) {
  const u = new URL("torneo.html", location.href); u.search = "";
  u.searchParams.set("t", tid); if (teamId) u.searchParams.set("e", teamId);
  return u.href;
}

// Tabla de posiciones en HTML
function standingsHtml(rows, highlight) {
  if (!rows.length) return `<p class="muted" style="margin:0">Aún no hay equipos.</p>`;
  return `<div class="tscroll"><table class="ttable"><thead><tr><th>#</th><th class="tl">Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr${r.team.id === highlight ? ' class="hl"' : ""}><td>${i + 1}</td><td class="tl"><span class="tname">${crestHtml(r.team, 22)}${esc(r.team.name)}</span></td><td>${r.pj}</td><td>${r.pg}</td><td>${r.pe}</td><td>${r.pp}</td><td>${r.gf}</td><td>${r.gc}</td><td>${r.dg > 0 ? "+" : ""}${r.dg}</td><td><b>${r.pts}</b></td></tr>`).join("")}
  </tbody></table></div>`;
}
function scorersHtml(stats, limit = 15) {
  const rows = stats.filter(s => s.goal).sort((a, b) => b.goal - a.goal || a.player.name.localeCompare(b.player.name)).slice(0, limit);
  if (!rows.length) return `<p class="muted" style="margin:0">Aún no hay goles registrados.</p>`;
  return `<table class="ttable"><thead><tr><th>#</th><th class="tl">Jugador</th><th class="tl">Equipo</th><th>Goles</th></tr></thead><tbody>
    ${rows.map((s, i) => `<tr><td>${i + 1}</td><td class="tl">${esc(s.player.name)}</td><td class="tl"><span class="tname">${crestHtml(s.team, 18)}${esc(s.team.name)}</span></td><td><b>${s.goal}</b></td></tr>`).join("")}
  </tbody></table>`;
}
function cardsHtml(stats) {
  const rows = stats.filter(s => s.yellow || s.red).sort((a, b) => b.red - a.red || b.yellow - a.yellow || a.player.name.localeCompare(b.player.name));
  if (!rows.length) return `<p class="muted" style="margin:0">Aún no hay tarjetas.</p>`;
  return `<table class="ttable"><thead><tr><th class="tl">Jugador</th><th class="tl">Equipo</th><th>🟨</th><th>🟥</th></tr></thead><tbody>
    ${rows.map(s => `<tr><td class="tl">${esc(s.player.name)}</td><td class="tl"><span class="tname">${crestHtml(s.team, 18)}${esc(s.team.name)}</span></td><td>${s.yellow}</td><td>${s.red}</td></tr>`).join("")}
  </tbody></table>`;
}
function matchRowHtml(D, m, attrs = "", tag = "div") {
  const tm = byId(D.teams), h = tm[m.home_id], a = tm[m.away_id];
  const score = m.played ? `<b class="score">${m.home_goals} - ${m.away_goals}</b>` : `<span class="score vs">vs</span>`;
  return `<${tag} class="match" ${attrs}><small class="muted">${esc(matchWhen(m) || "Sin fecha")}</small>
    <span class="mline"><span class="mteam">${esc(h ? h.name : "?")} ${crestHtml(h, 26)}</span>${score}<span class="mteam away">${crestHtml(a, 26)} ${esc(a ? a.name : "?")}</span></span></${tag}>`;
}

// Reporte de un equipo: plantilla con goles/tarjetas, partidos y su tabla
function teamReportHtml(D, team) {
  const cat = D.cats.find(c => c.id === team.category_id), ser = D.series.find(s => s.id === team.series_id);
  const stats = byId(playerStats(D, team.category_id).map(s => ({ id: s.player.id, ...s })));
  const players = D.players.filter(p => p.team_id === team.id);
  const ms = D.matches.filter(m => m.home_id === team.id || m.away_id === team.id);
  const group = D.teams.filter(t => t.category_id === team.category_id && (ser ? t.series_id === ser.id : true));
  const tot = players.reduce((a, p) => { const s = stats[p.id] || {}; a.g += s.goal || 0; a.y += s.yellow || 0; a.r += s.red || 0; return a; }, { g: 0, y: 0, r: 0 });
  return `<div class="report">
    <div class="rhead">${crestHtml(team, 64)}<div><h2>${esc(team.name)}</h2>
      <p class="muted" style="margin:0">${esc(D.t.name)} · ${esc(cat ? cat.name : "")}${ser ? " · Serie " + esc(ser.name) : ""}</p>
      ${team.coach_name ? `<p style="margin:0;font-size:14px">Técnico: <b>${esc(team.coach_name)}</b></p>` : ""}</div></div>
    <h3>Posiciones${ser ? " · Serie " + esc(ser.name) : ""}</h3>
    ${standingsHtml(standings(D, group, ser ? ser.id : undefined), team.id)}
    <h3>Jugadores (${players.length})</h3>
    ${players.length ? `<table class="ttable"><thead><tr><th>N°</th><th class="tl">Jugador</th><th>⚽</th><th>🟨</th><th>🟥</th></tr></thead><tbody>
      ${players.map(p => { const s = stats[p.id] || {}; return `<tr><td>${p.number ?? ""}</td><td class="tl"><span class="tname">${p.photo_url ? `<img class="pphoto" src="${esc(p.photo_url)}" alt="">` : `<span class="pphoto" aria-hidden="true"></span>`}${esc(p.name)}</span></td><td>${s.goal || 0}</td><td>${s.yellow || 0}</td><td>${s.red || 0}</td></tr>`; }).join("")}
      <tr class="tot"><td></td><td class="tl">Total</td><td>${tot.g}</td><td>${tot.y}</td><td>${tot.r}</td></tr></tbody></table>` : `<p class="muted" style="margin:0">Aún no hay jugadores inscritos.</p>`}
    <h3>Partidos</h3>
    ${ms.length ? ms.map(m => matchRowHtml(D, m)).join("") : `<p class="muted" style="margin:0">Aún no hay partidos programados.</p>`}
    <p class="muted" style="font-size:12px;margin:8px 0 0">Reporte generado el ${dayLabel(nowEc().date)}.</p>
  </div>`;
}
function teamReportText(D, team) {
  const ser = D.series.find(s => s.id === team.series_id);
  const group = D.teams.filter(t => t.category_id === team.category_id && (ser ? t.series_id === ser.id : true));
  const rows = standings(D, group, ser ? ser.id : undefined), pos = rows.findIndex(r => r.team.id === team.id), r = rows[pos];
  const stats = playerStats(D, team.category_id).filter(s => s.team.id === team.id);
  const top = stats.filter(s => s.goal).sort((a, b) => b.goal - a.goal).slice(0, 3).map(s => `${s.player.name} (${s.goal})`).join(", ");
  const y = stats.reduce((a, s) => a + s.yellow, 0), rd = stats.reduce((a, s) => a + s.red, 0);
  return `⚽ *${D.t.name}* · Reporte de ${team.name}\n` +
    (r ? `Posición: ${pos + 1}° ${ser ? "de la Serie " + ser.name : ""} · ${r.pts} pts (PJ ${r.pj}, PG ${r.pg}, PE ${r.pe}, PP ${r.pp}, GF ${r.gf}, GC ${r.gc})\n` : "") +
    (top ? `Goleadores: ${top}\n` : "") + `Tarjetas: ${y} amarillas, ${rd} rojas\n` +
    `Reporte completo: ${torneoLink(D.t.id, team.id)}`;
}
