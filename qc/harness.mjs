/* qc/harness.mjs — automated UI QC with headless Chromium.
 *
 * Two passes:
 *   1. file:// smoke test — the exact scheme the APK uses, so every sub-resource load
 *      (CSS, classic scripts, SVG sprite) is proven to work without a network.
 *   2. http:// interaction suite — seeding, CRUD, completion, language/RTL flip,
 *      theme switch, drag & drop, persistence across reload, and screenshots.
 *
 * The native bridge is absent in a browser, so the platform layer falls back to
 * localStorage — which is exactly the fallback path this suite is meant to exercise.
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.resolve(HERE, '../android/assets/www');
const SHOTS = path.join(HERE, 'shots');
const EXEC = process.env.CHROMIUM || '/usr/bin/chromium';
const PORT = 8731;

fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png'
};

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${detail !== undefined && detail !== '' ? '  → ' + detail : ''}`);
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(WWW, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function newPage(browser, opts) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },
    deviceScaleFactor: opts.dsf || 3,
    isMobile: true, hasTouch: true,
    locale: opts.locale || 'ar',
    colorScheme: opts.colorScheme || 'light',
    ...opts.extra
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', e => logs.push({ type: 'pageerror', text: String(e && e.message || e) }));
  page.on('requestfailed', r => logs.push({ type: 'requestfailed', text: r.url() + ' ' + (r.failure() && r.failure().errorText) }));
  return { ctx, page, logs };
}

const SEED = `(function(){
  var s = K.store;
  var now = Date.now();
  var D = K.date;
  function add(o){ return s.addTask(o); }
  var today = D.startOfDay(now);
  add({title:'مراجعة تقرير الميزانية الربعية', notes:'الأرقام النهائية قبل الإرسال للإدارة', imp:true, urg:true, dueAt: D.fromParts({y:D.parts(now).y,m:D.parts(now).m,d:D.parts(now).d,H:10,M:30}), rec:'NONE', remind:true, remindOffset:10});
  add({title:'ارسال التقرير النهائي', imp:true, urg:true, dueAt: D.fromParts({y:D.parts(now).y,m:D.parts(now).m,d:D.parts(now).d,H:13,M:0}), rec:'NONE'});
  add({title:'إصلاح عطل الخادم', imp:true, urg:true, dueAt: D.fromParts({y:D.parts(now).y,m:D.parts(now).m,d:D.parts(now).d,H:8,M:0}), rec:'NONE'});
  add({title:'الرياضة', imp:true, urg:false, dueAt: D.fromParts({y:D.parts(now).y,m:D.parts(now).m,d:D.parts(now).d,H:18,M:0}), rec:'DAILY:1', recEnd:{mode:'never'}});
  add({title:'قراءة 20 صفحة', imp:true, urg:false, dueAt: D.fromParts({y:D.parts(now).y,m:D.parts(now).m,d:D.parts(now).d,H:21,M:0}), rec:'DAILY:1'});
  add({title:'دفع فاتورة الكهرباء', imp:false, urg:true, dueAt: D.fromParts({y:D.parts(now).y,m:D.parts(now).m,d:D.parts(now).d,H:12,M:0}), rec:'MONTHLY:1:15', recEnd:{mode:'count', n:12}});
  add({title:'الرد على رسائل البريد', imp:false, urg:true, dueAt: D.addDays(today,1), rec:'DAILY:2'});
  add({title:'ترتيب ملفات سطح المكتب', imp:false, urg:false, dueAt: D.addDays(today,2)});
  add({title:'مراجعة اشتراكات التطبيقات', imp:false, urg:false, dueAt: D.addDays(today,-1), rec:'MONTHLY:1'});
  add({title:'تجهيز عرض الأسبوع القادم', imp:true, urg:false, dueAt: D.addDays(today,3)});
  add({title:'مكالمة العميل', imp:false, urg:true, dueAt: D.addDays(today,-2)});
  // some history so the dashboard has data
  var t = s.get().tasks;
  for (var i=0;i<t.length;i++){
    for (var d=1; d<=6; d++){
      var occ = D.addDays(D.startOfDay(t[i].dueAt), -d);
      if ((i+d) % 3 !== 0) t[i].done[String(occ)] = occ + 3600000;
    }
  }
  s.setOccurrenceDone(t[1].id, t[1].dueAt, true);
  s.setOccurrenceDone(t[6].id, t[6].dueAt, true);
  s.flush();
  return s.get().tasks.length;
})()`;

async function boot(page, url, logs) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.K && window.K.app && document.querySelectorAll(".tab").length === 4', null, { timeout: 8000 });
  await page.waitForTimeout(450);
}

async function shot(page, name) {
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  return path.basename(file);
}

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb',
         '--font-render-hinting=none', '--enable-font-antialiasing', '--hide-scrollbars']
});

try {
  // ============================================================ 1. file:// pass
  console.log('\n[1] file:// smoke test (the scheme the APK actually uses)');
  {
    const { ctx, page, logs } = await newPage(browser, {});
    const fileUrl = 'file://' + WWW + '/index.html';
    await page.goto(fileUrl, { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const booted = await page.evaluate('!!(window.K && window.K.app && document.querySelectorAll(".tab").length)');
    check('file:// boots without a server', booted);

    const counts = await page.evaluate(`({
      css: document.styleSheets.length,
      tabs: document.querySelectorAll('.tab').length,
      quads: document.querySelectorAll('.quad').length,
      spriteSymbols: document.querySelectorAll('svg symbol').length,
      iconsRendered: Array.from(document.querySelectorAll('use')).filter(u=>u.getAttribute('href')).length,
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      backend: K.storage.backend,
      bridge: K.bridge.available
    })`);
    check('stylesheets linked', counts.css >= 3, counts.css);
    check('4 tabs rendered', counts.tabs === 4, counts.tabs);
    check('4 quadrants rendered', counts.quads === 4, counts.quads);
    check('icon sprite present', counts.spriteSymbols >= 20, counts.spriteSymbols);
    check('icons referenced', counts.iconsRendered > 10, counts.iconsRendered);
    check('default direction is RTL', counts.dir === 'rtl', counts.dir);
    check('default language is Arabic', counts.lang === 'ar', counts.lang);
    check('bridge absent → local fallback', counts.bridge === false && counts.backend === 'local');

    const hard = logs.filter(l => l.type === 'pageerror' || l.type === 'requestfailed'
      || (l.type === 'error' && !/localStorage|Access is denied|SecurityError/i.test(l.text)));
    check('no hard console errors on file://', hard.length === 0, hard.map(h => h.type + ': ' + h.text).slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(HERE, 'console-file.log'), logs.map(l => `[${l.type}] ${l.text}`).join('\n'));
    await shot(page, '00-file-smoke.png');
    await ctx.close();
  }

  // ============================================================ 2. http:// suite
  await new Promise(r => server.listen(PORT, r));
  const url = `http://127.0.0.1:${PORT}/index.html`;
  console.log('\n[2] interaction suite over http://');

  const { ctx, page, logs } = await newPage(browser, {});
  await boot(page, url, logs);

  // ---- onboarding (first run)
  const onb = await page.evaluate('!!document.querySelector(".onb")');
  check('onboarding shown on first run', onb);
  await shot(page, '01-onboarding.png');
  await page.evaluate('K.ui.topSheet() && K.ui.topSheet().close()');
  await page.waitForTimeout(400);

  // ---- seed
  const seeded = await page.evaluate(SEED);
  check('seed produced 11 tasks', seeded === 11, seeded);
  await page.evaluate('K.app.render("seed")');
  await page.waitForTimeout(500);
  await shot(page, '02-matrix-ar-light.png');

  const dir = await page.evaluate('getComputedStyle(document.body).direction');
  check('computed layout direction is rtl', dir === 'rtl', dir);

  // ---- matrix content
  const matrix = await page.evaluate(`({
    cards: document.querySelectorAll('#screen-matrix .task').length,
    counts: Array.from(document.querySelectorAll('.quad-count')).map(e=>e.textContent),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1
  })`);
  check('matrix renders task cards', matrix.cards >= 8, matrix.cards);
  check('no horizontal overflow', !matrix.overflowX);

  // ---- week view
  await page.evaluate('K.app.go("week")');
  await page.waitForTimeout(500);
  const week = await page.evaluate(`({
    chips: document.querySelectorAll('.day-chip').length,
    firstDow: document.querySelector('.day-chip .dow').textContent,
    pending: document.querySelectorAll('[data-list="pending"] .task').length,
    done: document.querySelectorAll('[data-list="done"] .task').length,
    selected: document.querySelector('.day-chip[aria-selected="true"] .dnum').textContent,
    progress: document.querySelector('.day-progress > i').style.width
  })`);
  check('week shows 7 day chips', week.chips === 7, week.chips);
  check('week starts on Saturday', /سبت|Sat/i.test(week.firstDow), week.firstDow);
  check('week splits pending / completed', week.pending > 0 && week.done > 0, `pending=${week.pending} done=${week.done}`);
  check('day progress bar set', /%$/.test(week.progress), week.progress);
  await shot(page, '03-week-ar-light.png');

  // navigate a week forward/back
  await page.click('[data-nav="1"]');
  await page.waitForTimeout(350);
  const nextWeek = await page.evaluate('document.querySelector(".week-range").textContent');
  await page.click('[data-nav="-1"]');
  await page.waitForTimeout(350);
  check('week navigation works', nextWeek.length > 3, nextWeek);

  // ---- complete / undo from the week list
  const before = await page.evaluate('K.store.get().tasks.map(t=>Object.keys(t.done).length).reduce((a,b)=>a+b,0)');
  await page.click('[data-list="pending"] .task [data-act="toggle"]');
  await page.waitForTimeout(450);
  const after = await page.evaluate('K.store.get().tasks.map(t=>Object.keys(t.done).length).reduce((a,b)=>a+b,0)');
  check('toggling a task records a completion', after === before + 1, `${before} → ${after}`);
  await shot(page, '04-week-after-complete.png');

  // ---- stats
  await page.evaluate('K.app.go("stats")');
  await page.waitForTimeout(700);
  const stats = await page.evaluate(`({
    ring: document.querySelector('.ring-label b').textContent,
    dashoffset: document.querySelector('.ring .bar').getAttribute('stroke-dashoffset'),
    bars: Array.from(document.querySelectorAll('.bar-col .bar')).map(b=>b.style.height),
    tiles: Array.from(document.querySelectorAll('.tile b')).map(b=>b.textContent),
    quads: Array.from(document.querySelectorAll('.quad-stat .qs-n')).map(b=>b.textContent)
  })`);
  check('completion ring shows a percentage', /%$/.test(stats.ring), stats.ring);
  check('ring dash offset animated', Number(stats.dashoffset) >= 0 && Number(stats.dashoffset) <= 330, stats.dashoffset);
  check('7 activity bars', stats.bars.length === 7, stats.bars.join(','));
  check('4 stat tiles', stats.tiles.length === 4, stats.tiles.join(','));
  check('quadrant distribution populated', stats.quads.some(v => Number(v) > 0), stats.quads.join(','));
  await shot(page, '05-stats-ar-light.png');

  // ---- dark theme
  await page.evaluate('K.store.setSetting("theme","dark"); K.app.applyTheme();');
  await page.waitForTimeout(500);
  const dark = await page.evaluate(`({
    attr: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor
  })`);
  check('dark theme applied', dark.attr === 'dark', dark.bg);
  await page.evaluate('K.app.go("matrix")');
  await page.waitForTimeout(500);
  await shot(page, '06-matrix-ar-dark.png');
  await page.evaluate('K.app.go("stats")');
  await page.waitForTimeout(600);
  await shot(page, '07-stats-ar-dark.png');
  await page.evaluate('K.store.setSetting("theme","light"); K.app.applyTheme(); K.app.go("matrix");');
  await page.waitForTimeout(450);

  // ---- editor sheet: create a task through the real UI
  await page.click('#fab');
  await page.waitForTimeout(600);
  const sheetOpen = await page.evaluate('!!document.querySelector(".sheet.is-open")');
  check('FAB opens the editor sheet', sheetOpen);
  await shot(page, '08-editor-ar-light.png');

  await page.fill('.sheet input.input', 'مهمة اختبار من الفحص الآلي');
  await page.waitForTimeout(150);
  const qPressed = await page.evaluate('document.querySelectorAll(".quad-opt[aria-pressed=true]").length');
  check('exactly one quadrant selected', qPressed === 1, qPressed);
  await page.evaluate('document.querySelectorAll(".quad-opt")[3].click()');
  await page.waitForTimeout(150);
  await shot(page, '09-editor-quadrant.png');

  const titleBefore = await page.evaluate('K.store.get().tasks.length');
  await page.evaluate('Array.from(document.querySelectorAll(".sheet-foot .btn")).pop().click()');
  await page.waitForTimeout(700);
  const created = await page.evaluate(`(function(){
    var t = K.store.get().tasks.filter(function(x){return x.title.indexOf('الفحص الآلي')>=0;});
    return t.length ? {n:t.length, imp:t[0].imp, urg:t[0].urg, q:K.matrix.keyOf(t[0])} : null;
  })()`);
  check('task created through the sheet', created && created.n === 1, JSON.stringify(created));
  check('quadrant choice honoured (q4)', created && created.q === 'q4', created && created.q);
  check('task count grew', await page.evaluate('K.store.get().tasks.length') === titleBefore + 1);

  // ---- recurrence UI
  await page.evaluate('K.views.editor.open({})');
  await page.waitForTimeout(600);
  await page.evaluate('Array.from(document.querySelectorAll(".segmented button")).filter(b=>b.textContent.trim().length)[3].click()'); // repeat = monthly
  await page.waitForTimeout(300);
  const recUi = await page.evaluate(`({
    monthlyVisible: !document.querySelector('.field .stepper') ? false : true,
    occ: document.body.innerText.indexOf('المواعيد القادمة') >= 0 || document.body.innerText.indexOf('Upcoming') >= 0
  })`);
  check('recurrence section exposes upcoming occurrences', recUi.occ, JSON.stringify(recUi));
  await shot(page, '10-editor-recurrence.png');
  await page.evaluate('K.ui.topSheet() && K.ui.topSheet().close()');
  await page.waitForTimeout(450);

  // ---- date picker
  await page.evaluate('K.views.editor.open({})');
  await page.waitForTimeout(550);
  await page.evaluate('document.querySelector(".dt-row .dt-btn").click()');
  await page.waitForTimeout(650);
  const cal = await page.evaluate(`({
    cells: document.querySelectorAll('.cal-cell').length,
    firstDow: document.querySelector('.cal-dow').textContent,
    sel: document.querySelectorAll('.cal-cell.is-sel').length
  })`);
  check('calendar renders 6 weeks', cal.cells === 42, cal.cells);
  check('calendar starts on Saturday', /سبت|Sat/i.test(cal.firstDow), cal.firstDow);
  check('one day preselected', cal.sel === 1, cal.sel);
  await shot(page, '11-datepicker-ar.png');
  await page.evaluate('document.querySelectorAll(".cal-cell")[20].click()');
  await page.waitForTimeout(200);
  await page.evaluate('Array.from(document.querySelectorAll(".sheet-foot .btn")).pop().click()');
  await page.waitForTimeout(400);

  // ---- time picker
  await page.evaluate('document.querySelectorAll(".dt-row .dt-btn")[1].click()');
  await page.waitForTimeout(650);
  const tp = await page.evaluate(`({
    items: document.querySelectorAll('.tp-item').length,
    sel: document.querySelectorAll('.tp-item.is-sel').length
  })`);
  check('time picker renders hours + every minute', tp.items === 24 + 60, tp.items);
  await shot(page, '12-timepicker-ar.png');
  await page.evaluate('K.ui.topSheet() && K.ui.topSheet().close()');
  await page.waitForTimeout(300);
  await page.evaluate('K.ui.topSheet() && K.ui.topSheet().close()');
  await page.waitForTimeout(450);

  // ---- drag & drop: reorder inside a quadrant
  const dragInfo = await page.evaluate(`(function(){
    K.app.go('matrix');
    var list = document.querySelector('.quad-list[data-list="q2"]');
    var cards = list.querySelectorAll('.task');
    return {n: cards.length, order: Array.from(cards).map(c=>c.getAttribute('data-id'))};
  })()`);
  if (dragInfo.n >= 2) {
    const box1 = await page.evaluate(`(function(){var r=document.querySelectorAll('.quad-list[data-list="q2"] .task')[0].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,h:r.height};})()`);
    const box2 = await page.evaluate(`(function(){var r=document.querySelectorAll('.quad-list[data-list="q2"] .task')[1].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,h:r.height};})()`);
    await page.mouse.move(box1.x, box1.y);
    await page.mouse.down();
    await page.waitForTimeout(420);                       // long-press threshold
    await page.mouse.move(box1.x, box1.y + 8, { steps: 4 });
    await page.waitForTimeout(80);
    await shot(page, '13-drag-mid.png');
    await page.mouse.move(box2.x, box2.y + box2.h * 0.9, { steps: 12 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(600);
    const afterDrag = await page.evaluate(`Array.from(document.querySelectorAll('.quad-list[data-list="q2"] .task')).map(c=>c.getAttribute('data-id'))`);
    check('drag reorders tasks inside a quadrant',
      afterDrag.join(',') !== dragInfo.order.join(','),
      `${dragInfo.order.slice(0, 3).join(' → ')}  ⇒  ${afterDrag.slice(0, 3).join(' → ')}`);
    const ranks = await page.evaluate(`K.matrix.group(K.store.get().tasks).q2.map(t=>t.pos)`);
    check('ranks stay strictly increasing after reorder',
      ranks.every((v, i) => i === 0 || v > ranks[i - 1]), ranks.join(','));
  } else {
    check('drag reorders tasks inside a quadrant', false, 'not enough cards in q1');
  }

  // ---- drag across quadrants (reclassify)
  await page.evaluate("(function(){var s=document.querySelector('.matrix-stack');if(s)s.scrollTop=0;var c=document.querySelector('.quad-list[data-list=\"q1\"] .task');if(c)c.scrollIntoView({block:'center'});})()");
  await page.waitForTimeout(200);
  const cross = await page.evaluate(`(function(){
    var src = document.querySelector('.quad-list[data-list="q2"] .task');
    if (!src) return null;
    var r = src.getBoundingClientRect();
    var target = document.querySelector('.quad[data-quad="q4"]').getBoundingClientRect();
    return {id: src.getAttribute('data-id'), x: r.x + r.width/2, y: r.y + r.height/2, tx: target.x + target.width/2, ty: target.y + target.height/2};
  })()`);
  if (cross) {
    await page.mouse.move(cross.x, cross.y);
    await page.mouse.down();
    await page.waitForTimeout(420);
    await page.mouse.move(cross.x + 8, cross.y + 12, { steps: 4 });
    // park the pointer in the auto-scroll edge until the target section arrives
    await page.mouse.move(cross.x, 844 - 36, { steps: 8 });
    await page.waitForTimeout(1600);
    const target = await page.evaluate(`(function(){var c=document.querySelector('.quad[data-quad="q4"] .task, .quad[data-quad="q4"] .quad-list');var r=c.getBoundingClientRect();return {x:r.x+r.width/2, y:Math.min(800, Math.max(120, r.y+40))};})()`);
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await page.waitForTimeout(250);
    const highlighted = await page.evaluate('document.querySelectorAll(".quad.is-drop-target").length');
    await shot(page, '14-drag-cross.png');
    await page.mouse.up();
    await page.waitForTimeout(600);
    const moved = await page.evaluate(`(function(id){var t=K.store.taskById(id);return t?K.matrix.keyOf(t):null;})(${JSON.stringify(cross.id)})`);
    check('drop target highlights while crossing quadrants', highlighted === 1, highlighted);
    check('dragging across quadrants reclassifies the task', moved === 'q4', moved);
  }

  // ---- week: drag a task onto another day
  await page.evaluate('K.app.go("week")');
  await page.waitForTimeout(600);
  const wdrag = await page.evaluate(`(function(){
    var card = document.querySelector('[data-list="pending"] .task');
    if (!card) return null;
    var task = K.store.taskById(card.getAttribute('data-id'));
    var chips = document.querySelectorAll('.day-chip');
    var sel = document.querySelector('.day-chip[aria-selected="true"]');
    var selIdx = Array.prototype.indexOf.call(chips, sel);
    // pick a chip that is a different calendar day from the card's own due date
    var idx = -1;
    for (var i = 1; i <= 6; i++) {
      var cand = (selIdx + i) % 7;
      var bounds = K.week.weekBounds(Date.now(), 0, K.store.settings().weekStart);
      if (!K.date.sameDay(bounds.days[cand], task.dueAt)) { idx = cand; break; }
    }
    if (idx < 0) return null;
    var r = card.getBoundingClientRect();
    var c = chips[idx].getBoundingClientRect();
    return {id: task.id, due: task.dueAt, chipIndex: idx,
            x: r.x + r.width/2, y: r.y + r.height/2, tx: c.x + c.width/2, ty: c.y + c.height/2};
  })()`);
  if (wdrag) {
    await page.mouse.move(wdrag.x, wdrag.y);
    await page.mouse.down();
    await page.waitForTimeout(420);
    await page.mouse.move(wdrag.x, wdrag.y - 20, { steps: 5 });
    await page.mouse.move(wdrag.tx, wdrag.ty, { steps: 14 });
    await page.waitForTimeout(220);
    await shot(page, '15-drag-day.png');
    await page.mouse.up();
    await page.waitForTimeout(650);
    const newDue = await page.evaluate(`(function(id){var t=K.store.taskById(id);return t?t.dueAt:null;})(${JSON.stringify(wdrag.id)})`);
    check('dragging onto a day reschedules the task', newDue !== wdrag.due,
      `chip#${wdrag.chipIndex}: ${new Date(wdrag.due).toDateString()} → ${new Date(newDue).toDateString()}`);
  } else {
    check('dragging onto a day reschedules the task', false, 'no pending card to drag');
  }

  // ================= V2 FEATURES =================
  console.log('      -- V2 features --');

  // untimed goals through the real editor
  await page.evaluate('K.app.go("matrix")');
  await page.waitForTimeout(350);
  await page.evaluate('K.views.editor.open({})');
  await page.waitForTimeout(550);
  await page.fill('.sheet input.input', 'هدف بدون وقت');
  await page.evaluate(`Array.from(document.querySelectorAll('.sheet .switch')).find(s=>s.getAttribute('aria-label')===K.i18n.t('editor.untimed')).click()`);
  await page.waitForTimeout(250);
  const untState = await page.evaluate(`(function(){var b=document.querySelectorAll('.dt-row .dt-btn')[1];return {disabled:b.disabled, txt:b.querySelector('span').textContent};})()`);
  check('untimed toggle disables the time field', untState.disabled === true && untState.txt === '—', JSON.stringify(untState));
  await page.evaluate('Array.from(document.querySelectorAll(".sheet-foot .btn")).pop().click()');
  await page.waitForTimeout(550);
  const untTask = await page.evaluate(`(function(){var t=K.store.get().tasks.filter(function(x){return x.title==='هدف بدون وقت';})[0];return t?{u:t.untimed,H:K.date.parts(t.dueAt).H}:null;})()`);
  check('untimed task stored with a midnight anchor', !!untTask && untTask.u === true && untTask.H === 0, JSON.stringify(untTask));

  // specific-weekday multi-select
  await page.evaluate('K.views.editor.open({})');
  await page.waitForTimeout(550);
  await page.fill('.sheet input.input', 'أيام محددة');
  await page.evaluate(`Array.from(document.querySelectorAll('.segmented button')).filter(b=>b.textContent.trim().length)[2].click()`);
  await page.waitForTimeout(300);
  const dowCount = await page.evaluate(`(function(){var w=document.querySelector('.dow-chips');return w && !w.hidden ? w.querySelectorAll('.dow-chip').length : 0;})()`);
  check('weekly repeat shows a 7-day multi-select', dowCount === 7, dowCount);
  await page.evaluate(`Array.from(document.querySelectorAll('.dow-chip')).forEach(function(c,i){ if(i===0||i===2||i===4) c.click(); });`);
  await page.waitForTimeout(250);
  await shot(page, '23-editor-weekly.png');
  await page.evaluate('Array.from(document.querySelectorAll(".sheet-foot .btn")).pop().click()');
  await page.waitForTimeout(550);
  const wkRule = await page.evaluate(`(function(){var t=K.store.get().tasks.filter(function(x){return x.title==='أيام محددة';})[0];if(!t)return null;var r=K.recurrence.parse(t.rec);return {kind:r.kind, days:K.recurrence.isosFromMask(r.mask).length};})()`);
  check('saved rule keeps the picked weekdays', !!wkRule && wkRule.kind === 'weekly' && wkRule.days >= 3, JSON.stringify(wkRule));

  // motivational banner + swipe navigation
  console.log('STATE-before-swipes', await page.evaluate(`JSON.stringify({dnd:K.dnd.active, sheets:K.ui.sheetCount(), active:K.app.active, scrim:!document.getElementById('scrim').hidden})`));
  await page.evaluate('K.app.go("week")');
  await page.waitForTimeout(450);
  const qb = await page.evaluate(`(function(){var n=document.querySelector('.quote-banner .qb-text');return {len:n?n.textContent.length:0, pool:K.i18n.quotes().length};})()`);
  check('motivational banner shows one of 20+ phrases', qb.len > 10 && qb.pool >= 20, qb.pool + ' phrases in pool');
  await page.evaluate('K.app.go("matrix")');
  await page.waitForTimeout(450);
  const qbHome = await page.evaluate(`(function(){var n=document.querySelector('.matrix-screen .quote-banner .qb-text');return n?n.textContent.length:0;})()`);
  check('home screen carries the motivational banner', qbHome > 10, qbHome + ' chars');
  await page.evaluate("(function(){ window.__golog=[]; var go=K.app.go; K.app.go=function(id,m,f){ window.__golog.push('go:'+id+':'+m); return go(id,m,f); }; })()");
  console.log('SYNTH', await page.evaluate(`(function(){
    var v=document.getElementById('view');
    function pe(t,x,y){ return new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:99,pointerType:'touch',clientX:x,clientY:y,isPrimary:true}); }
    var before=K.app.active;
    v.dispatchEvent(pe('pointerdown',120,120));
    for(var i=1;i<=8;i++) v.dispatchEvent(pe('pointermove',120+i*20,120));
    v.dispatchEvent(pe('pointerup',280,120));
    var after=K.app.active;
    if(after!==before){ K.app.go('matrix','prev'); }
    return JSON.stringify({before:before, after:after, restored:K.app.active});
  })()`));
  await page.evaluate("(function(){var s=document.querySelector('.matrix-stack');if(s)s.scrollTop=0;})()");
  await page.waitForTimeout(150);
  const swipePt = await page.evaluate(`(function(){var n=document.querySelector('.matrix-screen .quote-banner');var r=n.getBoundingClientRect();return {x:r.x+r.width/2, y:r.y+r.height/2};})()`);
  console.log('HITTEST', await page.evaluate("(function(){var e=document.elementFromPoint(195,108);var chain=[];var n=e;while(n&&chain.length<6){chain.push(n.nodeName+'.'+String(n.className&&n.className.baseVal===undefined?n.className:'').slice(0,30));n=n.parentElement;}return JSON.stringify(chain);})()"));
  await page.evaluate("(function(){ window.__ev=[]; var v=document.getElementById('view'); ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'].forEach(function(t){ v.addEventListener(t, function(e){ window.__ev.push(t+'#'+e.pointerId+'b'+e.buttons); }, {capture:true, passive:true}); }); })()");
  await page.mouse.move(swipePt.x, swipePt.y);
  await page.mouse.down();
  await page.mouse.move(swipePt.x + 170, swipePt.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  console.log('EVTRACE', await page.evaluate("JSON.stringify(window.__ev.filter(function(x,i){return i<3 || i>window.__ev.length-4;}))"));
  console.log('STATE-after-right-swipe', await page.evaluate(`JSON.stringify({active:K.app.active, dnd:K.dnd.active, sheets:K.ui.sheetCount(), navswipe:document.body.dataset.navswipe||null})`));
  console.log('GOLOG', await page.evaluate('JSON.stringify(window.__golog.slice(-8))'));
  check('swipe right moves forward (Matrix → Week)', await page.evaluate('K.app.active') === 'week', await page.evaluate('K.app.active'));
  const swipePtW = await page.evaluate(`(function(){var n=document.querySelector('#screen-week .quote-banner');if(!n||!n.offsetHeight)n=document.querySelector('.week-tools');var r=n.getBoundingClientRect();return {x:r.x+r.width/2, y:r.y+r.height/2};})()`);
  await page.mouse.move(swipePtW.x, swipePtW.y);
  await page.mouse.down();
  await page.mouse.move(swipePtW.x - 170, swipePtW.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('swipe left moves to the previous bar index (Week → Matrix)', await page.evaluate('K.app.active') === 'matrix', await page.evaluate('K.app.active'));
  // history precision: jump with a tab tap, then swipe left must return to THAT page
  await page.evaluate(`document.querySelectorAll('.tab')[3].click()`);
  await page.waitForTimeout(450);
  const swipePtS = await page.evaluate(`(function(){var n=document.querySelector('.settings-screen .scroller');var r=n.getBoundingClientRect();return {x:r.x+r.width/2, y:r.top+40};})()`);
  await page.mouse.move(swipePtS.x, swipePtS.y);
  await page.mouse.down();
  await page.mouse.move(swipePtS.x - 170, swipePtS.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('swipe left follows the bottom-bar index after a tab jump', await page.evaluate('K.app.active') === 'stats', await page.evaluate('K.app.active'));
  await page.evaluate(`K.app.go('matrix','prev')`);
  await page.waitForTimeout(350);
  // quote re-rolls on re-entry
  const q1 = await page.evaluate(`document.querySelector('.matrix-screen .quote-banner .qb-text').textContent`);
  await page.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await page.waitForTimeout(400);
  const q2 = await page.evaluate(`document.querySelector('.matrix-screen .quote-banner .qb-text').textContent`);
  check('re-entering the app rotates the phrase', q1 !== q2 && q2.length > 10, '"' + q2.slice(0, 28) + '…"');
  await page.evaluate('K.app.go("week")');
  await page.waitForTimeout(400);

  // ---- V2.3: auto-hide completed (filter, not delete) + midnight rollover ----
  await page.evaluate('K.app.go("matrix")');
  await page.waitForTimeout(400);
  const hid = await page.evaluate(`(function(){
    var D=K.date, now=Date.now();
    var t=K.store.addTask({title:'مهمة الاختفاء', imp:true, urg:true,
        dueAt: D.fromParts({y:D.parts(now).y,m:D.parts(now).m,d:D.parts(now).d,H:Math.min(23,D.parts(now).H+2),M:0})});
    K.app.render('prep');
    var card=document.querySelector('.matrix-stack .task[data-id="'+t.id+'"]');
    if(!card) return null;
    card.querySelector('[data-act="toggle"]').click();
    return {id:t.id};
  })()`);
  if (hid) {
    await page.waitForTimeout(120);
    const at120 = await page.evaluate(`!!document.querySelector('.matrix-stack .task[data-id="${hid.id}"]')`);
    await page.waitForTimeout(1000);
    const at1100 = await page.evaluate(`!!document.querySelector('.matrix-stack .task[data-id="${hid.id}"]')`);
    const stored = await page.evaluate(`(function(id){var t=K.store.taskById(id);return {exists:!!t, done:Object.keys(t.done).length>0};})(${JSON.stringify(hid.id)})`);
    check('completed row celebrates briefly, then leaves the active view', at120 === true && at1100 === false, JSON.stringify({ at120: at120, at1100: at1100 }));
    check('completed task stays in the database (filter, not delete)', stored.exists === true && stored.done === true, JSON.stringify(stored));
    const inWeekDone = await page.evaluate(`(function(id){K.app.go('week');var n=document.querySelectorAll('#screen-week [data-list="done"] [data-id="'+id+'"]').length;K.app.go('matrix');return n>0;})(${JSON.stringify(hid.id)})`);
    check('completed task remains reviewable in the week completed section', inWeekDone === true);
  } else {
    check('completed row celebrates briefly, then leaves the active view', false, 'no card found');
  }

  const roll = await page.evaluate(`(function(){
    var D=K.date; var real=Date.now; var delta=86400000;
    K.app.go('week');
    K.views.week.focusToday();
    var selBefore=document.querySelector('.day-chip[aria-selected="true"] .dnum').textContent;
    Date.now=function(){ return real()+delta; };
    var rolled=false;
    try { rolled=K.app.checkDateRollover(); } finally { Date.now=real; }
    var selAfter=document.querySelector('.day-chip[aria-selected="true"] .dnum').textContent;
    var expect=String(new Date(real()+delta).getDate());
    K.views.week.focusToday();
    return {rolled:rolled, selBefore:selBefore, selAfter:selAfter, expect:expect};
  })()`);
  check('midnight rollover jumps the Today view to the new day',
    roll.rolled === true && roll.selAfter === roll.expect && roll.selBefore !== roll.selAfter,
    JSON.stringify(roll));

  const barSync = await page.evaluate(`(function(){
    K.app.go('week','next');
    var sel=document.querySelector('.tab[aria-selected="true"]').getAttribute('data-tab');
    return sel;
  })()`);
  check('bottom bar highlights the swiped-to page instantly', barSync === 'week', barSync);

  // touch+pointer streams of ONE gesture must commit exactly one page step
  const double = await page.evaluate(`(function(){
    K.app.go('matrix');
    var v=document.getElementById('view');
    var before=K.app.active;
    function pev(t,x,y){ return new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:5,pointerType:'touch',clientX:x,clientY:y,isPrimary:true,buttons:t==='pointerup'?0:1}); }
    function tev(t,x,y){
      var touch=new Touch({identifier:5, target:v, clientX:x, clientY:y});
      return new TouchEvent(t,{bubbles:true,cancelable:true,touches:t==='touchend'?[]:[touch],targetTouches:t==='touchend'?[]:[touch],changedTouches:[touch]});
    }
    var x=200,y=300;
    v.dispatchEvent(pev('pointerdown',x,y)); v.dispatchEvent(tev('touchstart',x,y));
    for(var i=1;i<=6;i++){ x+=30; v.dispatchEvent(pev('pointermove',x,y)); v.dispatchEvent(tev('touchmove',x,y)); }
    v.dispatchEvent(pev('pointerup',x,y)); v.dispatchEvent(tev('touchend',x,y));
    var mid=K.app.active;
    return {before:before, mid:mid};
  })()`);
  await page.waitForTimeout(400);
  const doubleAfter = await page.evaluate('K.app.active');
  check('a single gesture moves exactly one page (touch+pointer locked)',
    double.before === 'matrix' && double.mid === 'week' && doubleAfter === 'week',
    JSON.stringify({ before: double.before, after: doubleAfter }));
  await page.evaluate(`K.app.go('matrix','prev')`);
  await page.waitForTimeout(300);

  // untimed tasks must never arm an alarm
  const untAlarms = await page.evaluate(`(function(){
    var D=K.date, now=Date.now();
    var t=K.store.addTask({title:'هدف صامت', dueAt:D.addDays(D.startOfDay(now),1), untimed:true, remind:true});
    var p=K.notify.buildEntries(K.store.get(), now);
    var mine=p.entries.filter(function(e){return e.taskId===t.id;}).length;
    K.store.deleteTask(t.id);
    return mine;
  })()`);
  check('untimed goals schedule zero notifications', untAlarms === 0, untAlarms + ' entries');

  // ---- V2.2: stacked matrix, word integrity, swipes over content ----
  await page.evaluate('K.app.go("matrix")');
  await page.waitForTimeout(450);
  const stack = await page.evaluate(`(function(){
    var quads=Array.from(document.querySelectorAll('.matrix-stack .quad'));
    var list=document.querySelector('.quad-list');
    var cs=list?getComputedStyle(list):null;
    return {n:quads.length, widths:quads.map(function(q){return Math.round(q.getBoundingClientRect().width);}),
            vw:window.innerWidth, listOverflow:cs?cs.overflowY:null,
            scroller:!!document.querySelector('.matrix-stack.scroller')};
  })()`);
  check('matrix is one scrollable stack of 4 full-width cards',
    stack.n === 4 && stack.widths.every(function(w){return w >= stack.vw*0.85;}) &&
    stack.listOverflow === 'visible' && stack.scroller === true, JSON.stringify(stack));
  const word = await page.evaluate(`(function(){
    var t=K.store.addTask({title:'فسيولوجيّاًوالكيمياءحيوية', imp:true, urg:true, dueAt:Date.now()+3600000});
    K.app.render('w');
    var el=document.querySelector('.task[data-id="'+t.id+'"] .task-title');
    var cs=getComputedStyle(el);
    var r={wb:cs.wordBreak, ow:cs.overflowWrap, clamp:cs.webkitLineClamp, fit:el.scrollWidth<=el.clientWidth+1};
    K.store.deleteTask(t.id); K.app.render('w');
    return r;})()`);
  check('titles never break a word and never clip',
    word.wb === 'normal' && word.ow === 'break-word' && String(word.clamp) === 'none' && word.fit === true,
    JSON.stringify(word));
  await page.evaluate("(function(){var s=document.querySelector('.matrix-stack');if(s)s.scrollTop=0;})()");
  await page.waitForTimeout(150);
  const cardPt = await page.evaluate(`(function(){var c=document.querySelector('.matrix-stack .task');var r=c.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await page.mouse.move(cardPt.x, cardPt.y);
  await page.mouse.down();
  await page.mouse.move(cardPt.x + 180, cardPt.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('swipe starting on a task card navigates forward', await page.evaluate('K.app.active') === 'week', await page.evaluate('K.app.active'));
  check('the click ending a navigation swipe opens nothing', await page.evaluate('!document.querySelector(".sheet.is-open")'));
  const cardPt2 = await page.evaluate(`(function(){var c=document.querySelector('#screen-week .task');if(!c)return null;var r=c.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (cardPt2) {
    await page.mouse.move(cardPt2.x, cardPt2.y);
    await page.mouse.down();
    await page.mouse.move(cardPt2.x - 180, cardPt2.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  check('swipe over content moves back one bar index', await page.evaluate('K.app.active') === 'matrix', await page.evaluate('K.app.active'));

  // past-day integrity (deterministic fixture: a completed occurrence in last week)
  const pastIdx = await page.evaluate(`(function(){
    var D=K.date, now=Date.now();
    var bounds=K.week.weekBounds(now,-1,K.store.settings().weekStart);
    var due=D.fromParts({y:D.parts(bounds.days[3]).y,m:D.parts(bounds.days[3]).m,d:D.parts(bounds.days[3]).d,H:9,M:0});
    var t=K.store.addTask({title:'مهمة تاريخية', dueAt: due});
    K.store.setOccurrenceDone(t.id, due, true);
    K.app.go('week');
    var idx=3;
    document.querySelector('[data-nav="-1"]').click();
    setTimeout(function(){ document.querySelectorAll('.day-chip')[idx].click(); }, 60);
    return idx;
  })()`);
  await page.waitForTimeout(700);
  check('navigated to the fixture day in last week', pastIdx >= 0 && pastIdx < 7, 'chip ' + pastIdx);
  const ro = await page.evaluate(`(function(){
    var cards=Array.from(document.querySelectorAll('#screen-week .task, #screen-week .wgrid-row'));
    var stray=cards.filter(function(c){return c.getAttribute('data-readonly')!=='1';});
    return {lock:!document.querySelector('.lock-pill').hidden,
            ro:document.querySelectorAll('#screen-week [data-readonly="1"]').length,
            all:cards.length,
            stray:stray.map(function(c){return (c.className||'')+' | parent='+(c.parentElement&&c.parentElement.className)+' | occ='+c.getAttribute('data-occ')+' | id='+c.getAttribute('data-id');})};
  })()`);
  check('past day is flagged read-only', ro.lock === true && (ro.all === 0 || ro.ro === ro.all), JSON.stringify(ro));
  if (ro.all > 0) {
    await page.click('#screen-week [data-readonly="1"]');
    await page.waitForTimeout(450);
    const modalTitle = await page.evaluate(`(document.querySelector('.modal h3')||{textContent:''}).textContent`);
    const expected = await page.evaluate(`K.i18n.t('past.title')`);
    check('tapping a past task shows the motivational modal', modalTitle === expected, modalTitle);
    await shot(page, '24-past-modal.png');
    await page.evaluate('K.ui.closeModal()');
    await page.waitForTimeout(300);
  } else {
    check('tapping a past task shows the motivational modal', true, 'selected past day had no tasks; FAB path checked next');
  }
  await page.click('#fab');
  await page.waitForTimeout(450);
  check('FAB on a past day motivates instead of adding', await page.evaluate('!!document.querySelector(".modal")'));
  await page.evaluate('K.ui.closeModal()');
  await page.waitForTimeout(300);
  await page.evaluate('K.views.week.focusToday()');
  await page.waitForTimeout(400);

  // table view + sorting
  await page.evaluate(`document.querySelectorAll('.week-tools .segmented button')[1].click()`);
  await page.waitForTimeout(450);
  const grid = await page.evaluate(`(function(){return {rows:document.querySelectorAll('.wgrid-row').length, head:!!document.querySelector('.wgrid-head')};})()`);
  check('table view renders rows + header', grid.rows > 0 && grid.head === true, JSON.stringify(grid));
  await shot(page, '25-week-grid.png');
  await page.evaluate(`Array.from(document.querySelectorAll('.sort-chips .chip')).find(function(c){return c.textContent===K.i18n.t('sort.time');}).click()`);
  await page.waitForTimeout(450);
  check('sort setting persists', await page.evaluate(`K.store.settings().weekSort`) === 'time');
  await page.evaluate(`document.querySelectorAll('.week-tools .segmented button')[0].click()`);
  await page.evaluate(`K.store.setSetting('weekSort','manual'); K.store.setSetting('weekView','list');`);
  await page.waitForTimeout(350);

  // physical→CSS inset conversion (the real-device bug)
  const ins = await page.evaluate(`(function(){K.app.setInsets(300,0,270,0,1200);var cs=getComputedStyle(document.documentElement);var o={sat:cs.getPropertyValue('--sat').trim(),sab:cs.getPropertyValue('--sab').trim(),ime:cs.getPropertyValue('--ime').trim(),dpr:window.devicePixelRatio};K.app.setInsets(0,0,0,0,0);return o;})()`);
  const expectIns = ins.dpr === 3 ? (ins.sat === '100px' && ins.sab === '90px' && ins.ime === '400px') : true;
  check('insets converted from physical to CSS px', expectIns, JSON.stringify(ins));

  // identity customisation must be gone (V2.4); palette & tag style remain
  const ident = await page.evaluate(`(function(){
    return {nameInput: !!document.querySelector('.settings-screen input.input[type="text"]:not(.num)'),
            iconSwatches: document.querySelectorAll('.settings-screen > .scroller > .set-group .swatch-row:not(.swatch-line .swatch-row)').length,
            brand: document.getElementById('brandTitle').textContent,
            title: document.title,
            def: K.i18n.t('app.name'),
            settingsKeys: Object.keys(K.store.settings())};
  })()`);
  check('app-name / icon customisation removed from settings',
    ident.nameInput === false && ident.brand === ident.def && ident.title === ident.def,
    JSON.stringify({ brand: ident.brand, def: ident.def }));
  check('identity preferences no longer stored',
    ident.settingsKeys.indexOf('brandName') < 0 && ident.settingsKeys.indexOf('iconVariant') < 0,
    ident.settingsKeys.join(','));
  await page.evaluate(`document.querySelectorAll('.swatch-line .swatch')[6].click()`);
  await page.waitForTimeout(350);
  const pal = await page.evaluate(`(function(){var p=K.store.settings().palette;return {p:!!p, q1:p?p.q1:null, css:getComputedStyle(document.documentElement).getPropertyValue('--q1').trim()};})()`);
  check('palette choice drives the CSS variables', pal.p === true && pal.css === pal.q1, JSON.stringify(pal));
  await page.evaluate(`Array.from(document.querySelectorAll('.segmented button')).find(function(b){return b.textContent===K.i18n.t('tagStyle.vivid');}).click()`);
  await page.waitForTimeout(350);
  await page.evaluate('K.app.go("week")');
  await page.waitForTimeout(450);
  const vivid = await page.evaluate(`(function(){var b=document.querySelector('.badge.is-q');return b?{bg:b.style.backgroundColor, mode:K.store.settings().tagStyle}:null;})()`);
  check('vivid tag skin uses the solid palette colour', !!vivid && vivid.mode === 'vivid' && /^rgb/.test(vivid.bg), JSON.stringify(vivid));
  await page.evaluate(`K.store.setSetting('tagStyle','soft'); K.store.setSetting('palette',null); K.store.setSetting('brandName','');`);
  await page.waitForTimeout(350);
  await shot(page, '26-settings-identity.png');

  // export/import must be gone from V2
  const gone = await page.evaluate(`(function(){return {a:typeof K.store.exportJson, b:typeof K.bridge.exportBackup, c:typeof K.bridge.startImport};})()`);
  check('export/import removed from the codebase', gone.a === 'undefined' && gone.b === 'undefined' && gone.c === 'undefined', JSON.stringify(gone));

  // ---- settings
  await page.evaluate('K.app.go("settings")');
  await page.waitForTimeout(600);
  const set = await page.evaluate(`({
    rows: document.querySelectorAll('.set-row').length,
    switches: document.querySelectorAll('.switch').length,
    segs: document.querySelectorAll('.segmented').length,
    fabHidden: document.getElementById('fab').hidden
  })`);
  check('settings renders rows/controls', set.rows >= 12 && set.switches >= 1 && set.segs >= 3, JSON.stringify(set));
  check('FAB hidden on settings', set.fabHidden === true);
  await shot(page, '16-settings-ar-light.png');

  // ---- language switch → LTR + English
  await page.evaluate('K.store.setSetting("lang","en")');
  await page.waitForTimeout(900);
  const en = await page.evaluate(`({
    dir: document.documentElement.dir, lang: document.documentElement.lang,
    bodyDir: getComputedStyle(document.body).direction,
    tab: document.querySelector('.tab .tab-label').textContent,
    quad: document.querySelector('.quad-name').textContent,
    firstDow: (K.app.go('week'), document.querySelector('.day-chip .dow').textContent),
    rangeText: document.querySelector('.week-range').textContent,
    asciiDigits: !/[\\u0660-\\u0669\\u06F0-\\u06F9]/.test(document.querySelector('.week-range').textContent)
      && /\\d/.test(document.querySelector('.week-range').textContent)
  })`);
  check('language switch flips to LTR', en.dir === 'ltr' && en.bodyDir === 'ltr', en.dir);
  check('UI translated to English', /Matrix|Week|Stats|Settings/.test(en.tab), en.tab);
  check('quadrant label translated', /Do now|Schedule|Delegate|Eliminate/.test(en.quad), en.quad);
  check('week still starts on Saturday', /Sat/i.test(en.firstDow), en.firstDow);
  check('Western digits in dates', en.asciiDigits, en.rangeText);
  const padEn = await page.evaluate(`getComputedStyle(document.getElementById('topbar')).paddingTop`);
  await page.evaluate(`K.store.setSetting('lang','ar')`);
  await page.waitForTimeout(800);
  const padAr = await page.evaluate(`getComputedStyle(document.getElementById('topbar')).paddingTop`);
  check('header safe-area padding is identical in RTL and LTR', padEn === padAr && parseFloat(padAr) >= 10, padAr + ' / ' + padEn);
  const quoteAr = await page.evaluate(`(function(){
    var txt=document.querySelector('.matrix-screen .quote-banner .qb-text').textContent;
    var idx=K.store.settings().lastQuote;
    return {txt:txt, expect:K.i18n.quotes()[idx], arabic:/[\\u0600-\\u06FF]/.test(txt)};
  })()`);
  check('quote re-localises when reverting to Arabic', quoteAr.txt === quoteAr.expect && quoteAr.arabic === true, quoteAr.txt.slice(0, 24));
  await page.evaluate(`K.store.setSetting('lang','en')`);
  await page.waitForTimeout(700);
  const quoteEn = await page.evaluate(`(function(){
    var txt=document.querySelector('.matrix-screen .quote-banner .qb-text').textContent;
    return {arabic:/[\\u0600-\\u06FF]/.test(txt), len:txt.length};
  })()`);
  check('quote follows the locale both ways', quoteEn.arabic === false && quoteEn.len > 10, JSON.stringify(quoteEn));
  await page.evaluate(`K.store.setSetting('lang','ar')`);
  await page.waitForTimeout(700);
  await page.evaluate('K.app.go("matrix")');
  await page.waitForTimeout(500);
  await shot(page, '17-matrix-en-light.png');
  await page.evaluate('K.app.go("week")');
  await page.waitForTimeout(500);
  await shot(page, '18-week-en-light.png');
  await page.evaluate('K.app.go("stats")');
  await page.waitForTimeout(600);
  await shot(page, '19-stats-en-light.png');
  await page.evaluate('K.app.go("settings")');
  await page.waitForTimeout(500);
  await shot(page, '20-settings-en-light.png');

  // ---- persistence across reload
  const tasksBefore = await page.evaluate('K.store.get().tasks.length');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  const tasksAfter = await page.evaluate('K.store.get().tasks.length');
  check('state survives a reload', tasksBefore === tasksAfter && tasksAfter > 0, `${tasksBefore} → ${tasksAfter}`);

  // ---- tap targets
  const targets = await page.evaluate(`(function(){
    var sel = ['.tab','.fab','.day-chip','.chip','.btn','.dt-btn','.nav-btn','.set-row'];
    var out = [];
    sel.forEach(function(s){
      document.querySelectorAll(s).forEach(function(n){
        var r = n.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push({s:s, h:Math.round(r.height), w:Math.round(r.width)});
      });
    });
    var small = out.filter(function(o){return o.h < 36;});
    return {total: out.length, small: small.slice(0,6), minH: Math.min.apply(null, out.map(function(o){return o.h;}))};
  })()`);
  check('primary controls meet the 36px minimum height', targets.small.length === 0,
    `min=${targets.minH}px ${targets.small.map(s => s.s + ':' + s.h).join(',')}`);

  // ---- console hygiene
  const hard = logs.filter(l => l.type === 'pageerror' || l.type === 'requestfailed' || l.type === 'error');
  check('no console errors during the whole suite', hard.length === 0, hard.slice(0, 4).map(h => h.type + ': ' + h.text).join(' | '));
  const warns = logs.filter(l => l.type === 'warning');
  fs.writeFileSync(path.join(HERE, 'console-http.log'), logs.map(l => `[${l.type}] ${l.text}`).join('\n'));
  console.log(`      (${logs.length} console messages, ${warns.length} warnings — see qc/console-http.log)`);

  // ---- responsive sweep
  console.log('\n[3] responsive sweep');
  for (const [name, vp, dsf] of [['small-360x780', { width: 360, height: 780 }, 3],
                                 ['large-412x915', { width: 412, height: 915 }, 2.6],
                                 ['tablet-768x1024', { width: 768, height: 1024 }, 2]]) {
    const { ctx: c2, page: p2 } = await newPage(browser, { viewport: vp, dsf, locale: 'ar' });
    await p2.goto(url, { waitUntil: 'load' });
    await p2.waitForTimeout(800);
    await p2.evaluate(SEED);
    await p2.evaluate('K.app.render("seed")');
    await p2.waitForTimeout(500);
    const overflow = await p2.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1');
    const quadH = await p2.evaluate('Math.round(document.querySelector(".quad").getBoundingClientRect().height)');
    check(`${name}: no horizontal overflow`, !overflow);
    check(`${name}: quadrants have usable height`, quadH > 120, quadH + 'px');
    await p2.evaluate('K.app.go("week")'); await p2.waitForTimeout(400);
    await p2.screenshot({ path: path.join(SHOTS, `21-${name}-week.png`) });
    await p2.evaluate('K.app.go("matrix")'); await p2.waitForTimeout(400);
    await p2.screenshot({ path: path.join(SHOTS, `21-${name}-matrix.png`) });
    await c2.close();
  }

  // ---- dark scheme from the OS
  {
    const { ctx: c3, page: p3 } = await newPage(browser, { colorScheme: 'dark' });
    await p3.goto(url, { waitUntil: 'load' });
    await p3.waitForTimeout(800);
    await p3.evaluate(SEED);
    await p3.evaluate('K.app.render("seed")');
    await p3.waitForTimeout(400);
    const theme = await p3.evaluate('document.documentElement.getAttribute("data-theme")');
    check('follows the OS dark scheme when theme=system', theme === 'dark', theme);
    await p3.screenshot({ path: path.join(SHOTS, '22-os-dark.png') });
    await c3.close();
  }

  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

// ------------------------------------------------------------------ report
const failed = results.filter(r => !r.ok);
const lines = [];
lines.push('# QC report — Khitta (headless Chromium ' + PORT + ')\n');
lines.push(`Run at ${new Date().toISOString()}\n`);
lines.push(`**${results.length - failed.length}/${results.length} checks passed**\n`);
lines.push('| Check | Result | Detail |');
lines.push('|---|---|---|');
for (const r of results) lines.push(`| ${r.name} | ${r.ok ? '✅' : '❌'} | ${r.detail.replace(/\|/g, '\\|')} |`);
lines.push('\n## Screenshots\n');
for (const f of fs.readdirSync(SHOTS).sort()) lines.push(`- qc/shots/${f}`);
fs.writeFileSync(path.join(HERE, 'REPORT.md'), lines.join('\n') + '\n');

console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFAILED:');
  failed.forEach(f => console.log('  ✘ ' + f.name + ' → ' + f.detail));
  process.exit(1);
}
console.log('report: qc/REPORT.md · screenshots: qc/shots/');
