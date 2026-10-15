import {
  dayToIso,
  HEALTH_SIGNAL_LABEL,
  STATUS_LABEL,
  todayDay,
  activeBaseline,
  type Project,
} from '../engine';
import type { Derived } from '../store/derive';
import { safeFileName } from './files';
import { buildReport, tickList, type ReportOptions } from './report';

/**
 * One self-contained HTML page (inline CSS, a small vanilla script and the data as embedded
 * JSON; no external URLs) that works from file:// and on phones: overview, milestones,
 * a zoomable timeline with search and filters, and a watch list.
 */

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** JSON that is safe inside a <script> element (no "</script>", no HTML comment openers). */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

export function htmlReportFileName(project: Project, today: number = todayDay()): string {
  return `${safeFileName(project.name)} – schedule report ${dayToIso(today)}.html`;
}

export function buildHtmlReport(
  project: Project,
  derived: Derived,
  options: ReportOptions,
  today: number = todayDay(),
): string {
  const report = buildReport(project, derived, { ...options, scale: 'auto', layout: 'fit' }, today);
  const axisFrom = report.axis.from;
  const axisTo = report.axis.to;
  const data = {
    project: project.name,
    generated: today,
    today,
    status: report.statusDay,
    summary: options.includeSummary,
    fit: axisTo - axisFrom <= 200,
    baseline: !!activeBaseline(project) && options.includeBaseline,
    opts: { critical: options.highlightCritical, baseline: options.includeBaseline },
    kpis: report.kpis,
    milestones: report.milestones,
    phases: report.phases,
    slipping: report.slipping,
    next: report.nextWeeks,
    nextWindow: report.nextWindow,
    overview: { from: report.overview.from, to: report.overview.to },
    axis: { from: axisFrom, to: axisTo },
    ticks: {
      top: {
        month: tickList('month', axisFrom, axisTo, 'top'),
        quarter: tickList('quarter', axisFrom, axisTo, 'top'),
        year: tickList('year', axisFrom, axisTo, 'top'),
      },
      bottom: {
        week: tickList('week', axisFrom, axisTo, 'bottom'),
        month: tickList('month', axisFrom, axisTo, 'bottom'),
        quarter: tickList('quarter', axisFrom, axisTo, 'bottom'),
      },
    },
    labels: { status: STATUS_LABEL, signal: HEALTH_SIGNAL_LABEL },
    rows: report.rows.map((r) => ({
      id: r.id,
      rowId: r.rowId,
      name: r.name,
      depth: r.depth,
      kind: r.kind,
      phaseName: r.phaseName,
      color: r.color,
      start: r.start,
      finish: r.finish,
      duration: r.duration,
      percent: r.percent,
      status: r.status,
      signal: r.signal,
      critical: r.critical,
      totalFloat: r.totalFloat,
      bs: r.baselineStart,
      bf: r.baselineFinish,
      variance: r.variance,
      responsible: r.responsible,
    })),
  };

  const title = `${project.name} – schedule report`;
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="bar">
  <div class="row"><span class="brand">Villa Felstead</span><span class="pn" id="pn"></span></div>
  <div class="tabs" id="tabs" role="tablist"></div>
</div>
<main>
<section class="tab" id="tab-overview" hidden></section>
<section class="tab" id="tab-timeline" hidden>
  <div class="tools">
    <input id="q" type="search" placeholder="Search tasks" aria-label="Search tasks" autocomplete="off">
    <button class="rb" id="zout" aria-label="Zoom out">−</button>
    <button class="rb" id="zin" aria-label="Zoom in">+</button>
    <button class="rb" id="zfit">Fit</button>
    <button class="rb" id="ztoday">Today</button>
    <button class="rb" id="zall">Expand all</button>
  </div>
  <div class="chips" id="chips"></div>
  <div class="cnt" id="cnt"></div>
  <div class="tl" id="tl"></div>
</section>
<section class="tab" id="tab-watch" hidden></section>
</main>
<footer class="f"><span class="brand">Villa Felstead</span></footer>
<div class="sheet" id="sheet" hidden><div class="card" id="card" role="dialog" aria-modal="true"></div></div>
<noscript><p style="padding:16px">This report needs JavaScript to show the schedule.</p></noscript>
<script type="application/json" id="data">${jsonForScript(data)}</script>
<script>${REPORT_JS}</script>
</body>
</html>
`;
}

/** Stylesheet of the self-contained web-page report (no external fonts or URLs). */
const REPORT_CSS = String.raw`
:root{--ink:#2A211E;--warm:#462F28;--sand:#D9D0C8;--sand50:#ECE8E3;--sand25:#F6F3F1;--mocca:#8C7067;--crit:#B3261E;--ok:#4F7A4A;--warn:#9C6B1F;--line:#EFEBE7;--font:'GT Standard','GT Standard M','Helvetica Neue',Helvetica,Arial,sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--ink);font:15px/1.45 var(--font);font-weight:400}
h1,h2,h3,h4,b,strong,th,button,input{font-weight:400;font-family:inherit}
button{cursor:pointer;color:inherit}
.caps{text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--mocca)}
.bar{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid var(--ink)}
.bar .row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 16px 0}
.brand{letter-spacing:.32em;font-size:11px;text-transform:uppercase}
.bar .pn{font-size:12px;color:var(--mocca);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tabs{display:flex;padding:0 8px}
.tabs button{flex:1;border:0;background:none;padding:10px 4px 9px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mocca);border-bottom:2px solid transparent}
.tabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--ink)}
main{max-width:1100px;margin:0 auto}
section.tab{padding:0 16px 40px}
section.tab[hidden]{display:none}
.title{padding:22px 0 6px;border-bottom:1px solid var(--ink);margin-bottom:16px}
.title h1{font-size:26px;line-height:1.2;margin:4px 0 6px}
.title p{margin:0;color:var(--mocca);font-size:13px}
h2.sec{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink);margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--ink)}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(min-width:720px){.tiles{grid-template-columns:repeat(3,1fr)}}
.tile{border:1px solid var(--sand);padding:12px;background:var(--sand25);min-width:0}
.tile .v{font-size:20px;line-height:1.25;margin-top:4px}
.tile .s{font-size:12px;color:var(--mocca);margin-top:2px}
.tile.wide{grid-column:1/-1}
.late{color:var(--crit)}.atRisk{color:var(--warn)}.onTrack,.complete{color:var(--ok)}
.meter{height:8px;background:var(--sand50);margin-top:8px;position:relative}
.meter i{position:absolute;left:0;top:0;bottom:0;background:var(--warm)}
.stack{display:flex;height:12px;margin:6px 0 8px;background:var(--sand50)}
.stack i{display:block;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;flex:none}
.dot.ring{background:#fff!important;border:2px solid var(--ok)}
.li{display:flex;gap:10px;justify-content:space-between;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--sand);width:100%;background:none;border-left:0;border-right:0;border-top:0;text-align:left;font-size:15px}
.li .l{display:flex;gap:10px;min-width:0;align-items:flex-start}
.li .l .dot{margin-top:6px}
.li .nm{overflow-wrap:anywhere}
.li .sm{font-size:12px;color:var(--mocca)}
.li .r{text-align:right;white-space:nowrap;font-size:14px}
.li.done .nm,.li.done .r{color:var(--mocca)}
.ph{border-bottom:1px solid var(--sand);padding:11px 0;width:100%;background:none;border-left:0;border-right:0;border-top:0;text-align:left;display:block}
.ph .t{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.ph svg{display:block;width:100%;height:18px;margin-top:6px}
.muted{color:var(--mocca)}
.tools{display:flex;gap:8px;align-items:center;padding:12px 0 6px;flex-wrap:wrap}
.tools input{flex:1;min-width:150px;height:38px;border:1px solid var(--sand);padding:0 12px;border-radius:19px;font-size:15px;background:#fff}
.tools input:focus{outline:2px solid var(--sand);border-color:var(--warm)}
.rb{height:38px;min-width:38px;border:1px solid var(--sand);background:#fff;border-radius:19px;padding:0 12px;font-size:15px}
.rb:active,.chip:active{background:var(--sand50)}
.chips{display:flex;gap:6px;overflow-x:auto;padding:4px 0 8px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;height:32px;border:1px solid var(--sand);background:#fff;border-radius:16px;padding:0 12px;font-size:13px;white-space:nowrap}
.chip[aria-pressed=true]{background:var(--warm);border-color:var(--warm);color:#fff}
.cnt{font-size:12px;color:var(--mocca);margin:4px 0 8px}
.tl{overflow:auto;border:1px solid var(--sand);position:relative;background:#fff;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;min-height:260px}
.grid{display:grid;grid-template-columns:var(--nw) 1fr;width:max-content}
.corner{position:sticky;top:0;left:0;z-index:6;background:var(--sand25);border-bottom:1px solid var(--ink);border-right:1px solid var(--sand);padding:0 8px;display:flex;align-items:flex-end;padding-bottom:5px;height:44px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mocca)}
.head{position:sticky;top:0;z-index:5;background:var(--sand25);border-bottom:1px solid var(--ink);height:44px}
.names{position:sticky;left:0;z-index:4;background:#fff;border-right:1px solid var(--sand)}
.nr{display:flex;align-items:center;gap:4px;width:100%;height:30px;border:0;border-bottom:1px solid var(--line);background:#fff;text-align:left;font-size:13px;padding:0 6px 0 0;overflow:hidden;white-space:nowrap}
.nr span.t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;line-height:13px;font-size:12px;min-width:0;overflow-wrap:anywhere}
.nr.p{background:var(--sand25)}
.nr.m span.t::before{content:"\25C6\00a0";color:var(--mocca);font-size:10px}
.nr .ch{flex:none;width:18px;text-align:center;color:var(--mocca);font-size:11px}
.chart{display:block}
.chart .hit{fill:transparent;cursor:pointer}
.sheet{position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;background:rgba(42,33,30,.38)}
.sheet[hidden]{display:none}
.sheet .card{background:#fff;width:100%;max-width:560px;max-height:78vh;overflow:auto;border-radius:14px 14px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));border-top:1px solid var(--ink)}
@media(min-width:720px){.sheet{align-items:center}.sheet .card{border-radius:2px;border:1px solid var(--ink)}}
.card h3{font-size:19px;line-height:1.3;margin:2px 0 4px}
.card .x{float:right;border:0;background:none;font-size:26px;line-height:1;padding:0 4px;color:var(--mocca)}
.pills{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 6px}
.pill{border:1px solid var(--sand);border-radius:14px;padding:2px 10px;font-size:12px;display:inline-flex;gap:6px;align-items:center}
dl.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:12px 0 0;font-size:14px}
dl.kv dt{color:var(--mocca)}dl.kv dd{margin:0;text-align:right}
.empty{padding:24px;text-align:center;color:var(--mocca)}
footer.f{padding:20px 16px 30px;text-align:center}
@media print{.bar,.tools,.chips{display:none}section.tab[hidden]{display:block}}
`;
/** Client script of the web-page report. Plain ES2017, no template literals, no external calls. */
const REPORT_JS = String.raw`
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('data').textContent);
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var SIG = { late: '#B3261E', atRisk: '#9C6B1F', onTrack: '#4F7A4A', complete: '#4F7A4A' };
  var SIGL = D.labels.signal, STL = D.labels.status;
  var NS = 'http:/' + '/www.w3.org/2000/svg';
  var RH = 30;

  function dt(d) { return new Date(d * 864e5); }
  function fmt(d) { var x = dt(d); return DOW[x.getUTCDay()] + ' ' + x.getUTCDate() + ' ' + MON[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
  function fmtS(d) { var x = dt(d); return x.getUTCDate() + ' ' + MON[x.getUTCMonth()] + ' ' + x.getUTCFullYear(); }
  function plural(n, w) { return n + ' ' + w + (Math.abs(n) === 1 ? '' : 's'); }
  function varText(v) {
    if (v === null || v === undefined) return '';
    if (v === 0) return 'On baseline';
    return plural(Math.abs(v), 'working day') + (v > 0 ? ' later' : ' earlier') + ' than baseline';
  }
  function h(tag, props, kids) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      if (k === 'text') e.textContent = props[k];
      else if (k === 'cls') e.className = props[k];
      else if (k === 'on') for (var ev in props[k]) e.addEventListener(ev, props[k][ev]);
      else e.setAttribute(k, props[k]);
    }
    if (kids) for (var i = 0; i < kids.length; i++) { var c = kids[i]; if (c == null) continue; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return e;
  }
  function s(tag, attrs, parent, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function dot(sig) { var d = h('span', { cls: 'dot' + (sig === 'complete' ? ' ring' : '') }); d.style.background = SIG[sig]; return d; }
  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------------ header and overview
  $('pn').textContent = D.project;
  var tabsEl = $('tabs'), tabNames = D.summary ? ['overview', 'timeline', 'watch'] : ['timeline'];
  var tabLabel = { overview: 'Overview', timeline: 'Timeline', watch: 'Watch list' };
  var current = tabNames[0];
  tabNames.forEach(function (n) {
    tabsEl.appendChild(h('button', { role: 'tab', 'data-tab': n, text: tabLabel[n], on: { click: function () { showTab(n); } } }));
  });

  function tile(label, value, sub, cls, wide) {
    return h('div', { cls: 'tile' + (wide ? ' wide' : '') }, [
      h('div', { cls: 'caps', text: label }),
      h('div', { cls: 'v' + (cls ? ' ' + cls : ''), text: value }),
      sub ? h('div', { cls: 's', text: sub }) : null
    ]);
  }
  function stackBar(items, total) {
    var st = h('div', { cls: 'stack' });
    items.forEach(function (it) { if (!it.n) return; var i = h('i', { title: it.label + ': ' + it.n }); i.style.width = (it.n / total * 100) + '%'; i.style.background = it.color; st.appendChild(i); });
    return st;
  }
  function legend(items) {
    var l = h('div', { cls: 'legend' });
    items.forEach(function (it) {
      var d = h('span', { cls: 'dot' }); d.style.background = it.color;
      if (it.ring) { d.className = 'dot ring'; }
      l.appendChild(h('span', null, [d, it.label + ' ' + it.n]));
    });
    return l;
  }
  function sec(t) { return h('h2', { cls: 'sec', text: t }); }

  function buildOverview() {
    var K = D.kpis, root = $('tab-overview');
    root.appendChild(h('div', { cls: 'title' }, [
      h('div', { cls: 'caps', text: 'Schedule report' }),
      h('h1', { text: D.project }),
      h('p', { text: 'Status date ' + fmt(D.status) + ' · created ' + fmt(D.generated) })
    ]));
    var v = K.finishVariance;
    var vc = v === null ? 'muted' : v > 0 ? 'late' : 'onTrack';
    var tiles = h('div', { cls: 'tiles' });
    tiles.appendChild(tile('Project finish', fmt(K.projectFinish), v === null ? 'No baseline set' : varText(v), vc, true));
    tiles.appendChild(tile('Baseline finish', K.baselineFinish === null ? 'None' : fmtS(K.baselineFinish), K.baselineName || 'Save a baseline to track slippage'));
    var pc = tile('Overall complete', Math.round(K.percentComplete) + '%', 'Weighted by duration');
    var m = h('div', { cls: 'meter' }); var mi = h('i'); mi.style.width = K.percentComplete + '%'; m.appendChild(mi); pc.appendChild(m);
    tiles.appendChild(pc);
    tiles.appendChild(tile('Critical tasks left', String(K.criticalRemaining), 'On the critical path', K.criticalRemaining ? 'late' : ''));
    tiles.appendChild(tile('Project start', fmtS(K.projectStart), plural(K.taskCount, 'task') + ', ' + plural(K.milestoneCount, 'milestone')));
    tiles.appendChild(tile('Behind baseline', String(K.slippedCount), 'Open tasks finishing later than planned', K.slippedCount ? 'atRisk' : ''));
    root.appendChild(tiles);

    var total = K.taskCount || 1, sc = K.signalCounts, tc = K.statusCounts;
    var sig = [
      { label: 'Late', n: sc.late, color: SIG.late },
      { label: 'At risk', n: sc.atRisk, color: SIG.atRisk },
      { label: 'On track', n: sc.onTrack, color: SIG.onTrack },
      { label: 'Complete', n: sc.complete, color: SIG.complete, ring: true }
    ];
    root.appendChild(sec('Schedule signal'));
    root.appendChild(stackBar(sig, total));
    root.appendChild(legend(sig));
    var stc = { notStarted: '#8C7067', inProgress: '#462F28', onHold: '#9C6B1F', blocked: '#B3261E', complete: '#4F7A4A' };
    var sts = ['notStarted', 'inProgress', 'onHold', 'blocked', 'complete'].map(function (k) { return { label: STL[k], n: tc[k], color: stc[k] }; });
    root.appendChild(sec('Status'));
    root.appendChild(stackBar(sts, total));
    root.appendChild(legend(sts));

    root.appendChild(sec('Milestones'));
    D.milestones.forEach(function (ms) {
      var done = ms.status === 'complete';
      var right = h('div', { cls: 'r' }, [fmtS(ms.planned)]);
      if (ms.variance !== null && ms.variance !== 0 && !done) {
        var vv = h('div', { cls: 'sm ' + (ms.variance > 0 ? 'late' : 'onTrack'), text: (ms.variance > 0 ? '+' : '') + ms.variance + ' working days' });
        right.appendChild(vv);
      } else if (ms.variance === 0 && !done) right.appendChild(h('div', { cls: 'sm muted', text: 'On baseline' }));
      else if (done) right.appendChild(h('div', { cls: 'sm muted', text: 'Complete' }));
      root.appendChild(h('button', { cls: 'li' + (done ? ' done' : ''), on: { click: function () { openSheet(ms, 'milestone'); } } }, [
        h('span', { cls: 'l' }, [dot(ms.signal), h('span', null, [h('div', { cls: 'nm', text: ms.name }), h('div', { cls: 'sm', text: ms.phaseName })])]),
        right
      ]));
    });

    root.appendChild(sec('Phases'));
    var span = D.overview.to - D.overview.from;
    D.phases.forEach(function (p) {
      var svg = s('svg', { viewBox: '0 0 1000 18', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      var X = function (d) { return (d - D.overview.from) / span * 1000; };
      s('rect', { x: 0, y: 3, width: 1000, height: 12, fill: '#F6F3F1' }, svg);
      if (p.baselineStart !== null && D.baseline) s('rect', { x: X(p.baselineStart), y: 14, width: Math.max(2, X(p.baselineFinish + 1) - X(p.baselineStart)), height: 3, fill: '#C4B8AD' }, svg);
      var w = Math.max(3, X(p.finish + 1) - X(p.start));
      s('rect', { x: X(p.start), y: 3, width: w, height: 10, fill: p.color, 'fill-opacity': 0.4 }, svg);
      s('rect', { x: X(p.start), y: 3, width: w * p.percent / 100, height: 10, fill: p.color }, svg);
      s('line', { x1: X(D.status), x2: X(D.status), y1: 0, y2: 18, stroke: '#8C7067', 'stroke-width': 2, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }, svg);
      var row = h('button', { cls: 'ph', on: { click: function () { focusPhase(p.id); } } }, [
        h('div', { cls: 't' }, [
          h('span', { cls: 'l', style: 'display:flex;gap:8px;align-items:center;min-width:0' }, [dot(p.signal), h('span', { cls: 'nm', text: p.name })]),
          h('span', { cls: 'sm muted', text: Math.round(p.percent) + '% complete' })
        ]),
        h('div', { cls: 'sm muted', text: fmtS(p.start) + ' to ' + fmtS(p.finish) + ' · ' + STL[p.status] }),
        p.variance ? h('div', { cls: 'sm ' + (p.variance > 0 ? 'late' : 'onTrack'), text: (p.variance > 0 ? '+' : '') + plural(p.variance, 'working day') + ' against baseline' }) : null,
        svg
      ]);
      root.appendChild(row);
    });
    root.appendChild(h('p', { cls: 'sm muted', text: 'Bars share one time axis from ' + fmtS(D.overview.from) + ' to ' + fmtS(D.overview.to) + '. Dashed line: status date.' }));
  }

  function buildWatch() {
    var root = $('tab-watch');
    root.appendChild(h('div', { cls: 'title' }, [h('div', { cls: 'caps', text: 'Watch list' }), h('h1', { text: 'What needs attention' })]));
    root.appendChild(sec('Top 10 slipping or late tasks'));
    if (!D.slipping.length) root.appendChild(h('p', { cls: 'muted', text: 'No open task is late or behind its baseline.' }));
    D.slipping.forEach(function (t) {
      root.appendChild(h('button', { cls: 'li', on: { click: function () { openSheet(t, 'task'); } } }, [
        h('span', { cls: 'l' }, [dot(t.signal), h('span', null, [h('div', { cls: 'nm', text: t.name }), h('div', { cls: 'sm', text: t.phaseName })])]),
        h('div', { cls: 'r' }, [fmtS(t.finish), h('div', { cls: 'sm ' + (t.variance > 0 ? 'late' : 'atRisk'), text: t.variance > 0 ? '+' + t.variance + ' working days' : 'Negative float' })])
      ]));
    });
    root.appendChild(sec('Next four weeks'));
    root.appendChild(h('p', { cls: 'sm muted', text: fmtS(D.nextWindow.from) + ' to ' + fmtS(D.nextWindow.to - 1) }));
    if (!D.next.length) root.appendChild(h('p', { cls: 'muted', text: 'Nothing starts or finishes in this period.' }));
    D.next.forEach(function (t) {
      var what = t.event === 'milestone' ? 'Milestone' : 'Task ' + t.event;
      root.appendChild(h('button', { cls: 'li', on: { click: function () { openSheet(t, 'task'); } } }, [
        h('span', { cls: 'l' }, [dot(t.signal), h('span', null, [h('div', { cls: 'nm', text: t.name }), h('div', { cls: 'sm', text: t.phaseName + ' · ' + what })])]),
        h('div', { cls: 'r' }, [fmtS(t.date)])
      ]));
    });
  }

  // ------------------------------------------------------------------ timeline
  var R = D.rows, parent = [], hasKids = [];
  (function () {
    var stack = [];
    for (var i = 0; i < R.length; i++) {
      while (stack.length && R[stack[stack.length - 1]].depth >= R[i].depth) stack.pop();
      parent[i] = stack.length ? stack[stack.length - 1] : -1;
      hasKids[i] = i + 1 < R.length && R[i + 1].depth > R[i].depth;
      stack.push(i);
    }
  })();
  var S = { ppd: 1.1, expanded: {}, q: '', sig: {}, st: {}, crit: false, ms: false, laidOut: false, vis: [] };
  var tl = null, nameW = 150;

  function matches(r) {
    var q = S.q;
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.phaseName.toLowerCase().indexOf(q) < 0) return false;
    var anySig = false, anySt = false, k;
    for (k in S.sig) if (S.sig[k]) anySig = true;
    for (k in S.st) if (S.st[k]) anySt = true;
    if (anySig && !S.sig[r.signal]) return false;
    if (anySt && !S.st[r.status]) return false;
    if (S.crit && !r.critical) return false;
    if (S.ms && r.kind !== 'milestone') return false;
    return true;
  }
  function filtering() {
    var k;
    if (S.q || S.crit || S.ms) return true;
    for (k in S.sig) if (S.sig[k]) return true;
    for (k in S.st) if (S.st[k]) return true;
    return false;
  }
  function computeVisible() {
    var vis = [], i;
    if (!filtering()) {
      for (i = 0; i < R.length; i++) {
        var p = parent[i], ok = true;
        while (p >= 0) { if (!S.expanded[R[p].id]) { ok = false; break; } p = parent[p]; }
        if (ok) vis.push(i);
      }
      return vis;
    }
    var keep = {};
    for (i = 0; i < R.length; i++) {
      if (hasKids[i]) continue;
      if (matches(R[i])) { keep[i] = true; var a = parent[i]; while (a >= 0) { keep[a] = true; a = parent[a]; } }
    }
    for (i = 0; i < R.length; i++) if (keep[i]) vis.push(i);
    return vis;
  }

  function levels() {
    var p = S.ppd;
    if (p >= 5) return { top: 'month', bottom: 'week' };
    if (p >= 1.6) return { top: 'quarter', bottom: 'month' };
    return { top: 'year', bottom: 'quarter' };
  }
  function X(d) { return (d - D.axis.from) * S.ppd; }

  function renderTimeline() {
    var vis = computeVisible(); S.vis = vis;
    var forced = filtering();
    var W = Math.ceil((D.axis.to - D.axis.from) * S.ppd), H = vis.length * RH;
    tl.innerHTML = '';
    var grid = h('div', { cls: 'grid' });
    grid.style.setProperty('--nw', nameW + 'px');
    grid.appendChild(h('div', { cls: 'corner', text: 'Task' }));
    // header
    var head = h('div', { cls: 'head' });
    var hs = s('svg', { width: W, height: 44, viewBox: '0 0 ' + W + ' 44' }, head);
    var lv = levels(), tiers = [[D.ticks.top[lv.top], 0, 22], [D.ticks.bottom[lv.bottom], 22, 22]];
    tiers.forEach(function (t, ti) {
      t[0].forEach(function (k) {
        var x1 = X(k.day), x2 = X(k.end), w = x2 - x1;
        s('line', { x1: x1, x2: x1, y1: t[1], y2: t[1] + t[2], stroke: ti ? '#D9D0C8' : '#8C7067', 'stroke-width': 1 }, hs);
        var label = w > k.label.length * 6.5 + 10 ? k.label : (w > k.short.length * 6.5 + 8 ? k.short : '');
        if (!label) return;
        if (ti === 0) s('text', { x: Math.max(x1, 0) + 5, y: 15, 'font-size': 11, fill: '#2A211E' }, hs, label);
        else s('text', { x: x1 + w / 2, y: 37, 'font-size': 11, fill: '#8C7067', 'text-anchor': 'middle' }, hs, label);
      });
    });
    s('line', { x1: 0, x2: W, y1: 22, y2: 22, stroke: '#D9D0C8' }, hs);
    [[D.status, '#8C7067', 'Status'], [D.today, '#462F28', 'Today']].forEach(function (m, i) {
      if (m[0] < D.axis.from || m[0] > D.axis.to || (i === 1 && m[0] === D.status)) return;
      var x = X(m[0]);
      s('rect', { x: x - 1, y: 22, width: 2, height: 22, fill: m[1] }, hs);
    });
    grid.appendChild(head);
    // names
    var names = h('div', { cls: 'names' });
    vis.forEach(function (i) {
      var r = R[i], open = forced || S.expanded[r.id];
      var btn = h('button', { cls: 'nr' + (r.kind === 'phase' || r.kind === 'summary' ? ' p' : '') + (r.kind === 'milestone' ? ' m' : ''), title: r.name,
        on: { click: function () { if (hasKids[i] && !forced) { S.expanded[r.id] = !S.expanded[r.id]; renderTimeline(); } else openSheet(r, 'row'); } } }, [
        h('span', { cls: 'ch', text: hasKids[i] ? (open ? '▾' : '▸') : '' }),
        h('span', { cls: 't', text: r.name })
      ]);
      btn.style.paddingLeft = (r.depth * 12 + 2) + 'px';
      names.appendChild(btn);
    });
    grid.appendChild(names);
    // chart
    var cw = h('div'); cw.style.width = W + 'px';
    var svg = s('svg', { cls: 'chart', width: W, height: Math.max(H, 1), viewBox: '0 0 ' + W + ' ' + Math.max(H, 1) }, null);
    svg.setAttribute('class', 'chart');
    D.ticks.bottom[lv.bottom].forEach(function (k) { s('line', { x1: X(k.day), x2: X(k.day), y1: 0, y2: H, stroke: '#EFEBE7' }, svg); });
    D.ticks.top[lv.top].forEach(function (k) { s('line', { x1: X(k.day), x2: X(k.day), y1: 0, y2: H, stroke: '#D9D0C8' }, svg); });
    vis.forEach(function (i, n) {
      var r = R[i], y = n * RH;
      if (r.kind === 'phase' || r.kind === 'summary') s('rect', { x: 0, y: y, width: W, height: RH, fill: '#F6F3F1' }, svg);
      s('line', { x1: 0, x2: W, y1: y + RH - 0.5, y2: y + RH - 0.5, stroke: '#EFEBE7' }, svg);
    });
    [[D.status, '#8C7067', '5 4'], [D.today, '#462F28', '']].forEach(function (m, i) {
      if (m[0] < D.axis.from || m[0] > D.axis.to || (i === 1 && m[0] === D.status)) return;
      var a = { x1: X(m[0]) + 0.5, x2: X(m[0]) + 0.5, y1: 0, y2: H, stroke: m[1], 'stroke-width': 1.5 };
      if (m[2]) a['stroke-dasharray'] = m[2];
      s('line', a, svg);
    });
    vis.forEach(function (i, n) {
      var r = R[i], y = n * RH, cy = y + RH / 2;
      var color = D.opts.critical && r.critical ? '#B3261E' : r.color;
      var x1 = X(r.start), x2 = X(r.finish + 1), w = Math.max(3, x2 - x1);
      var hitX = x1 - 8, hitW = w + 16;
      if (D.opts.baseline && r.bs !== null && r.kind !== 'milestone') s('rect', { x: X(r.bs), y: y + RH - 7, width: Math.max(2, X(r.bf + 1) - X(r.bs)), height: 3, fill: '#C4B8AD' }, svg);
      if (r.kind === 'milestone') {
        var cx = X(r.start + 0.5);
        if (D.opts.baseline && r.bf !== null) s('rect', { x: X(r.bf + 0.5) - 2, y: y + RH - 7, width: 4, height: 3, fill: '#C4B8AD' }, svg);
        s('rect', { x: cx - 6, y: cy - 6, width: 12, height: 12, fill: color, transform: 'rotate(45 ' + cx + ' ' + cy + ')' }, svg);
        if (S.ppd >= 0.7) {
          var right = cx + 12 + 70 < W;
          s('text', { x: right ? cx + 12 : cx - 12, y: cy + 4, 'font-size': 11, fill: '#2A211E', 'text-anchor': right ? 'start' : 'end' }, svg, fmtS(r.start));
        }
        hitX = cx - 14; hitW = 28;
      } else if (r.kind === 'phase' || r.kind === 'summary') {
        var big = r.kind === 'phase';
        if (big) {
          s('rect', { x: x1, y: cy - 6, width: w, height: 12, fill: color, 'fill-opacity': 0.4 }, svg);
          s('rect', { x: x1, y: cy - 6, width: w * r.percent / 100, height: 12, fill: color }, svg);
          s('rect', { x: x1, y: cy - 6, width: w, height: 2, fill: '#2A211E' }, svg);
        } else {
          s('rect', { x: x1, y: cy - 3, width: w, height: 5, fill: '#2A211E' }, svg);
        }
        s('rect', { x: x1, y: cy - (big ? 6 : 3), width: 2, height: big ? 14 : 9, fill: '#2A211E' }, svg);
        s('rect', { x: x1 + w - 2, y: cy - (big ? 6 : 3), width: 2, height: big ? 14 : 9, fill: '#2A211E' }, svg);
        if (w > 40 && big) s('text', { x: x1 + 6, y: cy + 3.5, 'font-size': 10, fill: '#2A211E' }, svg, Math.round(r.percent) + '%');
      } else {
        s('rect', { x: x1, y: cy - 6, width: w, height: 12, rx: 1.5, fill: color, 'fill-opacity': 0.4 }, svg);
        if (r.percent > 0) s('rect', { x: x1, y: cy - 6, width: w * r.percent / 100, height: 12, rx: 1.5, fill: color }, svg);
        if (r.signal === 'late') s('rect', { x: x1, y: cy - 8, width: w, height: 1.5, fill: '#B3261E' }, svg);
      }
      var hit = s('rect', { x: hitX, y: y, width: hitW, height: RH, cls: 'hit' }, svg);
      hit.setAttribute('class', 'hit');
      hit.addEventListener('click', function () { openSheet(r, 'row'); });
    });
    cw.appendChild(svg); grid.appendChild(cw);
    tl.appendChild(grid);
    var n = vis.length;
    $('cnt').textContent = n ? 'Showing ' + plural(n, 'row') + ' of ' + R.length + '. Tap a bar for details.' : '';
    if (!n) tl.appendChild(h('div', { cls: 'empty', text: 'No tasks match the search and filters.' }));
  }

  function sizeTimeline() {
    var top = tl.getBoundingClientRect().top;
    var avail = window.innerHeight - top - 56;
    tl.style.height = Math.max(300, Math.min(avail, 1400)) + 'px';
    nameW = window.innerWidth < 600 ? 150 : 260;
  }
  function viewW() { return Math.max(100, tl.clientWidth - nameW); }
  function centerDay() { return D.axis.from + (tl.scrollLeft + viewW() / 2) / S.ppd; }
  function scrollToDay(d, frac) { tl.scrollLeft = Math.max(0, (d - D.axis.from) * S.ppd - viewW() * (frac == null ? 0.5 : frac)); }
  function setZoom(ppd, keepCenter) {
    var c = centerDay();
    S.ppd = Math.max(0.12, Math.min(16, ppd));
    renderTimeline();
    if (keepCenter) scrollToDay(c, 0.5);
  }
  function fit() { setZoom(viewW() / (D.axis.to - D.axis.from), false); tl.scrollLeft = 0; }
  function goToday() {
    var d = D.today >= D.axis.from && D.today <= D.axis.to ? D.today : D.status;
    scrollToDay(d, 0.3);
  }
  function focusPhase(id) {
    S.expanded[id] = true;
    showTab('timeline');
    renderTimeline();
    var idx = S.vis.map(function (i) { return R[i].id; }).indexOf(id);
    if (idx >= 0) tl.scrollTop = Math.max(0, idx * RH - 44);
  }

  var timelineScroll = { x: 0, y: 0 };
  function showTab(n) {
    if (current === 'timeline' && tl) timelineScroll = { x: tl.scrollLeft, y: tl.scrollTop };
    current = n;
    tabNames.forEach(function (t) { $('tab-' + t).hidden = t !== n; });
    Array.prototype.forEach.call(tabsEl.children, function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === n ? 'true' : 'false'); });
    if (n === 'timeline') {
      sizeTimeline();
      if (!S.laidOut) {
        S.laidOut = true;
        S.ppd = D.fit ? viewW() / (D.axis.to - D.axis.from) : Math.max(0.7, Math.min(2.2, viewW() / 540));
        renderTimeline();
        goToday();
      } else {
        renderTimeline();
        tl.scrollLeft = timelineScroll.x; tl.scrollTop = timelineScroll.y;
      }
    } else window.scrollTo(0, 0);
  }

  function buildTools() {
    var q = $('q');
    q.addEventListener('input', function () { S.q = q.value.trim().toLowerCase(); renderTimeline(); });
    $('zin').addEventListener('click', function () { setZoom(S.ppd * 1.5, true); });
    $('zout').addEventListener('click', function () { setZoom(S.ppd / 1.5, true); });
    $('zfit').addEventListener('click', fit);
    $('ztoday').addEventListener('click', goToday);
    var all = true;
    $('zall').addEventListener('click', function () {
      R.forEach(function (r, i) { if (hasKids[i]) S.expanded[r.id] = all; });
      $('zall').textContent = all ? 'Collapse all' : 'Expand all';
      all = !all; renderTimeline();
    });
    var chips = $('chips'), K = D.kpis;
    function chip(label, n, on) {
      var b = h('button', { cls: 'chip', 'aria-pressed': 'false', text: label + (n == null ? '' : ' ' + n) });
      b.addEventListener('click', function () { var p = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', p ? 'true' : 'false'); on(p); renderTimeline(); });
      chips.appendChild(b);
    }
    [['late', 'Late'], ['atRisk', 'At risk'], ['onTrack', 'On track']].forEach(function (x) { if (K.signalCounts[x[0]]) chip(x[1], K.signalCounts[x[0]], function (p) { S.sig[x[0]] = p; }); });
    chip('Critical', K.criticalRemaining, function (p) { S.crit = p; });
    chip('Milestones', K.milestoneCount, function (p) { S.ms = p; });
    ['inProgress', 'notStarted', 'onHold', 'blocked', 'complete'].forEach(function (k) { if (K.statusCounts[k]) chip(STL[k], K.statusCounts[k], function (p) { S.st[k] = p; }); });
  }

  // ------------------------------------------------------------------ detail sheet
  function openSheet(o, kind) {
    var card = $('card'); card.innerHTML = '';
    var name = o.name, phase = o.phaseName;
    var start = kind === 'milestone' ? o.planned : o.start;
    var finish = kind === 'milestone' ? o.planned : o.finish;
    var isMs = kind === 'milestone' || o.kind === 'milestone' || o.isMilestone;
    var bf = kind === 'milestone' ? o.baseline : (o.bf !== undefined ? o.bf : o.baselineFinish);
    var v = o.variance;
    card.appendChild(h('button', { cls: 'x', 'aria-label': 'Close', text: '×', on: { click: closeSheet } }));
    card.appendChild(h('div', { cls: 'caps', text: phase }));
    card.appendChild(h('h3', { text: name }));
    var pills = h('div', { cls: 'pills' });
    var sp = h('span', { cls: 'pill' }, [dot(o.signal), SIGL[o.signal]]); pills.appendChild(sp);
    pills.appendChild(h('span', { cls: 'pill', text: STL[o.status] }));
    if (o.critical) { var cp = h('span', { cls: 'pill late', text: 'Critical path' }); pills.appendChild(cp); }
    card.appendChild(pills);
    var kv = h('dl', { cls: 'kv' });
    function row(a, b) { if (b === '' || b == null) return; kv.appendChild(h('dt', { text: a })); kv.appendChild(h('dd', { text: String(b) })); }
    row(isMs ? 'Date' : 'Start', fmt(start));
    if (!isMs) row('Finish', fmt(finish));
    if (!isMs && o.duration !== undefined) row('Duration', plural(o.duration, 'working day'));
    if (o.percent !== undefined && !isMs) row('Complete', Math.round(o.percent) + '%');
    if (o.totalFloat !== null && o.totalFloat !== undefined) row('Float', plural(o.totalFloat, 'working day'));
    if (D.baseline && bf !== null && bf !== undefined) row(isMs ? 'Baseline date' : 'Baseline finish', fmt(bf));
    if (D.baseline && v !== null && v !== undefined) row('Against baseline', varText(v));
    row('Responsible', o.responsible);
    if (o.rowId || o.n) row('Row', o.rowId || o.n);
    card.appendChild(kv);
    $('sheet').hidden = false;
  }
  function closeSheet() { $('sheet').hidden = true; }
  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  // ------------------------------------------------------------------ start
  tl = $('tl');
  if (D.summary) { buildOverview(); buildWatch(); }
  buildTools();
  window.addEventListener('resize', function () { if (current === 'timeline') { sizeTimeline(); renderTimeline(); } });
  showTab(current);
})();
`;
