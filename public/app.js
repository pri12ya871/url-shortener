/* ============================================================
   snip. — frontend behaviour
   Talks to the real API; falls back to generated data when the
   backend (Postgres/Redis) isn't running, so the UI always demos.
   ============================================================ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  demo: false,
  code: null,
  days: 30,
  analytics: null,
};

/* ============================================================
   1. theme
   ============================================================ */
const THEME_KEY = 'snip-theme';
const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
else if (matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';

$('#themeToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  // Re-render the chart: its gradients and dot fills are theme-derived.
  if (state.analytics) drawChart(state.analytics.timeline, { animate: false });
});

/* ============================================================
   2. ambient chrome — nav, scroll progress, pointer glow
   ============================================================ */
const nav = $('#nav');
const progress = $('#scrollProgress');

const onScroll = () => {
  nav.classList.toggle('stuck', window.scrollY > 12);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
};
addEventListener('scroll', onScroll, { passive: true });
onScroll();

if (!REDUCED && matchMedia('(pointer: fine)').matches) {
  const glow = $('#pointerGlow');
  let gx = 0, gy = 0, tx = 0, ty = 0, raf = null;
  addEventListener('pointermove', (e) => {
    tx = e.clientX; ty = e.clientY;
    glow.classList.add('on');
    if (!raf) raf = requestAnimationFrame(followPointer);
  });
  function followPointer() {
    gx += (tx - gx) * 0.09;
    gy += (ty - gy) * 0.09;
    glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
    raf = Math.hypot(tx - gx, ty - gy) > 0.5 ? requestAnimationFrame(followPointer) : null;
  }
}

/* magnetic buttons — pull toward the cursor, spring back on leave */
if (!REDUCED && matchMedia('(pointer: fine)').matches) {
  $$('.magnetic').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(e.clientX - r.left - r.width / 2) * 0.22}px`);
      el.style.setProperty('--my', `${(e.clientY - r.top - r.height / 2) * 0.3}px`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--mx', '0px');
      el.style.setProperty('--my', '0px');
    });
  });
}

/* ============================================================
   3. scroll reveal + count-up
   ============================================================ */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('in');
    $$('.stat-num', entry.target).forEach(countUp);
    revealObserver.unobserve(entry.target);
  });
}, { threshold: 0.12, rootMargin: '0px 0px -60px' });

$$('.reveal').forEach((el) => revealObserver.observe(el));

function countUp(el) {
  const literal = el.dataset.literal;
  if (literal) return scramble(el, literal);

  const target = Number(el.dataset.count || 0);
  const decimals = Number(el.dataset.decimals || 0);
  const suffix = el.dataset.suffix || '';
  const render = (v) => { el.textContent = v.toFixed(decimals) + suffix; };

  if (REDUCED) return render(target);

  const duration = 1400;
  let start = null;
  const tick = (now) => {
    if (start === null) start = now;
    const t = Math.min((now - start) / duration, 1);
    render(target * (1 - Math.pow(1 - t, 4))); // easeOutQuart
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* glitch-settle effect for non-numeric stats like "~0ms" */
function scramble(el, text) {
  if (REDUCED) { el.textContent = text; return; }
  const chars = '0123456789~msxKMB';
  let frame = 0;
  const id = setInterval(() => {
    const settled = Math.floor(frame / 3);
    el.textContent = text
      .split('')
      .map((c, i) => (i < settled ? c : chars[Math.floor(Math.random() * chars.length)]))
      .join('');
    if (settled >= text.length) { clearInterval(id); el.textContent = text; }
    frame++;
  }, 40);
}

/* ============================================================
   4. toasts
   ============================================================ */
function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 4200);
}

/* ============================================================
   5. API layer
   ============================================================ */
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error?.message || `Request failed (${res.status})`);
  }
  return body;
}

async function checkHealth() {
  const pill = $('#apiStatus');
  const text = $('#apiStatusText');
  try {
    const health = await api('/health');
    const live = health.db === 'up';
    state.demo = !live;
    pill.classList.toggle('is-up', live);
    pill.classList.toggle('is-down', !live);
    text.textContent = live
      ? (health.cache === 'up' ? 'db + cache up' : 'db up · no cache')
      : 'database down';
  } catch {
    state.demo = true;
    pill.classList.add('is-down');
    text.textContent = 'offline';
  }
  $('#demoBadge').hidden = !state.demo;
}

/* ============================================================
   6. shorten form
   ============================================================ */
const form = $('#shortenForm');
const urlInput = $('#urlInput');
const submitBtn = $('#submitBtn');
const field = $('.field');

$('#advToggle').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  $('#advanced').classList.toggle('open', !open);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return reject('Paste a URL first.');
  if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url)) {
    return reject('That needs to be an absolute http(s) URL with a real host.');
  }

  submitBtn.classList.add('is-loading');
  try {
    const payload = { url };
    const custom = $('#codeInput').value.trim();
    if (custom) payload.customCode = custom;
    const expires = $('#expiresInput').value;
    if (expires) payload.expiresAt = new Date(expires).toISOString();

    const link = state.demo
      ? mockLink(url, custom)
      : await api('/api/links', { method: 'POST', body: JSON.stringify(payload) });

    showResult(link);
    toast(`Created /${link.code}`, 'ok');
    loadAnalytics(link.code);
    if (!state.demo) loadRecent();
  } catch (err) {
    reject(err.message);
  } finally {
    submitBtn.classList.remove('is-loading');
  }
});

function reject(message) {
  field.classList.remove('shake');
  void field.offsetWidth; // force reflow so the animation can restart
  field.classList.add('shake');
  toast(message, 'error');
}

function showResult(link) {
  const box = $('#result');
  box.hidden = false;
  // Restart the entry animation on repeat submissions.
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';

  const short = link.shortUrl || `${location.origin}/${link.code}`;
  const anchor = $('#resultUrl');
  anchor.textContent = short.replace(/^https?:\/\//, '');
  anchor.href = short;
  $('#resultTarget').textContent = link.targetUrl;
  $('#statsBtn').onclick = () => {
    loadAnalytics(link.code);
    $('#dashboard').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
  };

  const copyBtn = $('#copyBtn');
  copyBtn.classList.remove('copied');
  $('.copy-label', copyBtn).textContent = 'Copy';
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(short);
    } catch {
      return toast('Clipboard blocked — copy it manually.', 'error');
    }
    copyBtn.classList.add('copied');
    $('.copy-label', copyBtn).textContent = 'Copied';
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      $('.copy-label', copyBtn).textContent = 'Copy';
    }, 2000);
  };
}

/* ============================================================
   7. analytics
   ============================================================ */
const dashBody = $('#dashBody');
const dashEmpty = $('#dashEmpty');

$('#lookupBtn').addEventListener('click', () => {
  const code = $('#lookupInput').value.trim();
  if (code) loadAnalytics(code);
});
$('#lookupInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#lookupBtn').click();
});

/* range switcher — the sliding "ink" follows the active button */
const rangeInk = $('#rangeInk');
function moveInk(btn) {
  rangeInk.style.width = `${btn.offsetWidth}px`;
  rangeInk.style.transform = `translateX(${btn.offsetLeft - 4}px)`;
}
$$('.range-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.range-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    moveInk(btn);
    state.days = Number(btn.dataset.days);
    if (state.code) loadAnalytics(state.code);
  });
});
addEventListener('load', () => moveInk($('.range-btn.is-active')));
addEventListener('resize', () => moveInk($('.range-btn.is-active')));

async function loadAnalytics(code) {
  state.code = code;
  $('#lookupInput').value = code;
  dashBody.classList.add('is-loading');

  let data;
  try {
    data = state.demo
      ? mockAnalytics(code, state.days)
      : await api(`/api/links/${encodeURIComponent(code)}/analytics?days=${state.days}`);
  } catch (err) {
    dashBody.classList.remove('is-loading');
    return toast(err.message, 'error');
  }

  state.analytics = data;
  dashEmpty.classList.add('is-hidden');
  dashBody.classList.remove('is-hidden', 'is-loading');
  renderAnalytics(data);
}

function renderAnalytics(data) {
  animateNumber($('#tTotal'), data.totals.clicks);
  animateNumber($('#tUnique'), data.totals.uniqueVisitors);
  animateNumber($('#t24h'), data.totals.last24h);
  $('#tLast').textContent = data.totals.lastClickAt
    ? `last click ${relativeTime(data.totals.lastClickAt)}`
    : 'no clicks yet';

  const short = data.shortUrl || `${location.origin}/${data.code}`;
  const link = $('#tShort');
  link.textContent = `/${data.code}`;
  link.href = short;
  $('#tTarget').textContent = data.targetUrl || '—';

  const series = data.timeline.map((d) => d.clicks);
  sparkline($('#sparkTotal'), series);
  sparkline($('#sparkUnique'), series.map((v) => Math.round(v * 0.62)));

  drawChart(data.timeline);
  renderBars($('#barsReferrers'), data.topReferrers, 'direct');
  renderBars($('#barsDevices'), data.devices);
  renderBars($('#barsBrowsers'), data.browsers);
}

function animateNumber(el, target) {
  if (REDUCED) { el.textContent = formatNumber(target); return; }
  const from = Number(String(el.textContent).replace(/[^\d]/g, '')) || 0;
  const duration = 900;
  let start = null;
  const tick = (now) => {
    if (start === null) start = now;
    const t = Math.min((now - start) / duration, 1);
    el.textContent = formatNumber(Math.round(from + (target - from) * (1 - Math.pow(1 - t, 4))));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const formatNumber = (n) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 10_000  ? `${(n / 1000).toFixed(1)}k`
  : n.toLocaleString();

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/* ---------- bar rows ---------- */
function renderBars(list, rows, fallbackLabel = 'unknown') {
  list.replaceChildren();
  if (!rows?.length) {
    const empty = document.createElement('li');
    empty.className = 'bars-empty';
    empty.textContent = 'No data yet.';
    list.append(empty);
    return;
  }

  const max = Math.max(...rows.map((r) => r.clicks), 1);
  rows.slice(0, 6).forEach((row, i) => {
    const li = document.createElement('li');
    li.className = 'bar-row';
    li.style.setProperty('--i', i);

    const top = document.createElement('div');
    top.className = 'bar-top';
    const name = document.createElement('span');
    name.className = 'bar-name';
    // textContent, never innerHTML — these values come from request headers.
    name.textContent = row.value === 'unknown' ? fallbackLabel : row.value;
    const val = document.createElement('span');
    val.className = 'bar-val';
    val.textContent = formatNumber(row.clicks);
    top.append(name, val);

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.setProperty('--i', i);
    track.append(fill);

    li.append(top, track);
    list.append(li);

    // Next frame so the width transition actually runs.
    requestAnimationFrame(() => { fill.style.width = `${(row.clicks / max) * 100}%`; });
  });
}

/* ---------- sparklines ---------- */
function sparkline(path, values) {
  if (!path || values.length < 2) { path?.removeAttribute('d'); return; }
  const max = Math.max(...values, 1);
  const step = 100 / (values.length - 1);
  const d = values
    .map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)} ${(26 - (v / max) * 24).toFixed(2)}`)
    .join(' ');
  path.setAttribute('d', d);
  const len = path.getTotalLength();
  path.style.setProperty('--len', len);
  path.style.animation = 'none';
  void path.getBoundingClientRect();
  path.style.animation = '';
}

/* ============================================================
   8. the chart
   ============================================================ */
const CHART = { w: 780, h: 260, padTop: 18, padBottom: 26, padX: 8 };

function drawChart(timeline, { animate = true } = {}) {
  const points = (timeline || []).map((d) => ({ day: d.day, clicks: d.clicks }));
  const linePath = $('#linePath');
  const areaPath = $('#areaPath');
  const dots = $('#dots');
  const grid = $('#gridLines');

  grid.replaceChildren();
  dots.replaceChildren();

  if (points.length < 2) {
    linePath.removeAttribute('d');
    areaPath.removeAttribute('d');
    $('#chartAxis').replaceChildren();
    return;
  }

  const max = Math.max(...points.map((p) => p.clicks), 1);
  const innerH = CHART.h - CHART.padTop - CHART.padBottom;
  const x = (i) => CHART.padX + (i / (points.length - 1)) * (CHART.w - CHART.padX * 2);
  const y = (v) => CHART.padTop + innerH - (v / max) * innerH;

  /* grid lines + value labels */
  for (let i = 0; i <= 4; i++) {
    const value = Math.round((max / 4) * (4 - i));
    const gy = CHART.padTop + (innerH / 4) * i;
    const line = svgEl('line', { x1: CHART.padX, x2: CHART.w - CHART.padX, y1: gy, y2: gy });
    const label = svgEl('text', { x: CHART.padX, y: gy - 5 });
    label.textContent = formatNumber(value);
    grid.append(line, label);
  }

  /* smoothed line through the points */
  const coords = points.map((p, i) => [x(i), y(p.clicks)]);
  const d = smoothPath(coords);
  linePath.setAttribute('d', d);
  areaPath.setAttribute(
    'd',
    `${d} L ${coords.at(-1)[0]} ${CHART.h - CHART.padBottom} L ${coords[0][0]} ${CHART.h - CHART.padBottom} Z`,
  );

  /* data points */
  coords.forEach(([cx, cy], i) => {
    const c = svgEl('circle', { cx, cy, r: 3 });
    c.style.setProperty('--i', i);
    if (animate && !REDUCED) { c.setAttribute('r', 0); c.classList.add('play'); }
    dots.append(c);
  });

  /* x axis */
  const axis = $('#chartAxis');
  axis.replaceChildren();
  const ticks = [0, Math.floor(points.length / 3), Math.floor((points.length * 2) / 3), points.length - 1];
  [...new Set(ticks)].forEach((i) => {
    const span = document.createElement('span');
    span.textContent = shortDate(points[i].day);
    axis.append(span);
  });

  /* replay the draw animations */
  if (animate && !REDUCED) {
    const len = linePath.getTotalLength();
    linePath.style.setProperty('--len', len);
    restartAnimation(linePath, 'play');
    restartAnimation($('#revealRect'), 'play');
  } else {
    linePath.style.setProperty('--len', 0);
  }

  wireChartHover(points, coords);
}

/* Catmull-Rom → cubic bezier, so the line curves without overshooting much */
function smoothPath(pts) {
  if (pts.length < 3) return pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ');
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18; // tension — lower is tighter to the data
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

function wireChartHover(points, coords) {
  const wrap = $('#chartWrap');
  const tooltip = $('#tooltip');
  const crosshair = $('#crosshair');
  const circles = $$('#dots circle');

  wrap.onpointermove = (e) => {
    const rect = wrap.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    const [cx, cy] = coords[i];

    circles.forEach((c, idx) => c.classList.toggle('hot', idx === i));

    crosshair.classList.add('on');
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);

    tooltip.hidden = false;
    $('.tt-day', tooltip).textContent = longDate(points[i].day);
    $('.tt-val', tooltip).textContent = `${points[i].clicks.toLocaleString()} clicks`;
    tooltip.style.left = `${(cx / CHART.w) * rect.width}px`;
    tooltip.style.top = `${(cy / CHART.h) * rect.height}px`;
  };

  wrap.onpointerleave = () => {
    tooltip.hidden = true;
    crosshair.classList.remove('on');
    circles.forEach((c) => c.classList.remove('hot'));
  };
}

const svgEl = (tag, attrs) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

function restartAnimation(el, className) {
  el.classList.remove(className);
  void el.getBoundingClientRect();
  el.classList.add(className);
}

const shortDate = (day) =>
  new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = (day) =>
  new Date(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/* ============================================================
   9. recent links
   ============================================================ */
async function loadRecent() {
  if (state.demo) return;
  let links;
  try {
    ({ links } = await api('/api/links?limit=6'));
  } catch {
    return;
  }
  if (!links?.length) return;

  const list = $('#recentList');
  list.replaceChildren();
  links.forEach((link) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'recent-item';
    btn.type = 'button';

    const code = document.createElement('span');
    code.className = 'recent-code';
    code.textContent = `/${link.code}`;
    const target = document.createElement('span');
    target.className = 'recent-target';
    target.textContent = link.targetUrl;

    const arrow = svgEl('svg', { viewBox: '0 0 24 24' });
    arrow.append(svgEl('path', { d: 'M5 12h13m-5-6 6 6-6 6' }));

    btn.append(code, target, arrow);
    btn.addEventListener('click', () => loadAnalytics(link.code));
    li.append(btn);
    list.append(li);
  });
  $('#recentWrap').hidden = false;
}

/* ============================================================
   10. demo data — used only when the backend is unreachable
   ============================================================ */
function mockLink(url, custom) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const code = custom || Array.from({ length: 7 }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return {
    code,
    targetUrl: url,
    shortUrl: `${location.origin}/${code}`,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    isActive: true,
  };
}

function mockAnalytics(code, days) {
  const timeline = [];
  let total = 0;
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    // A weekly rhythm plus a slow upward trend and a bit of noise.
    const weekly = Math.sin((days - i) / 7 * Math.PI * 2) * 0.35 + 1;
    const trend = 1 + (days - i) / days * 1.4;
    const clicks = Math.max(0, Math.round(28 * weekly * trend + (Math.random() - 0.5) * 22));
    total += clicks;
    timeline.push({ day: date.toISOString().slice(0, 10), clicks });
  }

  return {
    code,
    shortUrl: `${location.origin}/${code}`,
    targetUrl: 'https://example.com/a-fairly-long-destination-url/with/a/path',
    createdAt: new Date(Date.now() - days * 864e5).toISOString(),
    totals: {
      clicks: total,
      uniqueVisitors: Math.round(total * 0.63),
      last24h: timeline.at(-1).clicks,
      lastClickAt: new Date(Date.now() - 1000 * 60 * 17).toISOString(),
    },
    timeline,
    topReferrers: [
      { value: 'https://news.ycombinator.com', clicks: Math.round(total * 0.31) },
      { value: 'https://twitter.com',          clicks: Math.round(total * 0.24) },
      { value: 'unknown',                      clicks: Math.round(total * 0.19) },
      { value: 'https://linkedin.com',         clicks: Math.round(total * 0.14) },
      { value: 'https://reddit.com',           clicks: Math.round(total * 0.08) },
    ],
    devices: [
      { value: 'mobile',  clicks: Math.round(total * 0.56) },
      { value: 'desktop', clicks: Math.round(total * 0.38) },
      { value: 'tablet',  clicks: Math.round(total * 0.06) },
    ],
    browsers: [
      { value: 'Chrome',  clicks: Math.round(total * 0.52) },
      { value: 'Safari',  clicks: Math.round(total * 0.27) },
      { value: 'Firefox', clicks: Math.round(total * 0.13) },
      { value: 'Edge',    clicks: Math.round(total * 0.08) },
    ],
  };
}

/* ============================================================
   11. boot
   ============================================================ */
await checkHealth();
await loadRecent();

// Give the empty dashboard something to show without waiting on a click.
if (state.demo) {
  loadAnalytics('demo42');
} else {
  const first = $('.recent-item');
  if (first) first.click();
}
