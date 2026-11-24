/* UniAssist: front end for a Markus-powered university assistant.
   Demo mode = scripted local replies. Live mode = Markus REST API via the local proxy (server.js). */

const AGENTS = [
  { key: 'support', icon: '💬', name: 'Student Support', role: 'support',
    sub: 'General questions about university life',
    desc: 'Answers student questions about rules, deadlines, scholarships and housing, and escalates what it cannot answer.' },
  { key: 'registration', icon: '📝', name: 'Registration Advisor', role: 'secretary',
    sub: 'Courses, credits and timetable conflicts',
    desc: 'Helps students register for courses: checks credit limits, prerequisites and timetable clashes before submission.' },
  { key: 'report', icon: '📄', name: 'Report Writer', role: 'research-assistant',
    sub: 'Outlines, drafts and references',
    desc: 'Helps students plan and draft academic reports with a clear structure, sources and a chosen citation style.' },
  { key: 'schedule', icon: '🗓️', name: 'Study Planner', role: 'project-manager',
    sub: 'Deadlines into a weekly plan',
    desc: 'Turns assignment deadlines and exams into a realistic weekly study schedule.' },
];

const state = {
  mode: localStorage.getItem('ua.mode') || 'demo',
  current: 'support',
  liveAgents: {},            // key -> Markus agent id
  history: {},               // key -> [{who, text}]
  tasks: JSON.parse(localStorage.getItem('ua.tasks') || '[]'),
};

const $ = (s) => document.querySelector(s);
const el = {
  list: $('#agent-list'), msgs: $('#messages'), form: $('#chat-form'), input: $('#chat-input'),
  send: $('#btn-send'), title: $('#chat-title'), sub: $('#chat-sub'), badge: $('#mode-badge'),
  tasks: $('#task-list'),
};

/* ---------- Rendering ---------- */
function renderAgents() {
  el.list.innerHTML = '';
  for (const a of AGENTS) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'agent';
    b.setAttribute('aria-current', String(a.key === state.current));
    b.innerHTML = `<span class="ico">${a.icon}</span><span><strong>${a.name}</strong><small>${a.sub}</small></span><span class="dot" title="online"></span>`;
    b.addEventListener('click', () => selectAgent(a.key));
    li.appendChild(b); el.list.appendChild(li);
  }
}

function selectAgent(key) {
  state.current = key;
  const a = AGENTS.find((x) => x.key === key);
  el.title.textContent = a.name; el.sub.textContent = a.sub;
  renderAgents(); renderMessages();
  if (!(state.history[key] || []).length) addMsg('system', `You are talking to ${a.name}. ${a.sub}.`, key);
}

function renderMessages() {
  el.msgs.innerHTML = '';
  for (const m of state.history[state.current] || []) paint(m);
  el.msgs.scrollTop = el.msgs.scrollHeight;
}

function paint(m) {
  const d = document.createElement('div');
  d.className = `msg ${m.who}${m.typing ? ' typing' : ''}`;
  d.textContent = m.text; // textContent: never inject agent output as HTML
  el.msgs.appendChild(d);
  el.msgs.scrollTop = el.msgs.scrollHeight;
  return d;
}

function addMsg(who, text, key = state.current) {
  const m = { who, text };
  (state.history[key] ||= []).push(m);
  if (key === state.current) paint(m);
  return m;
}

function renderTasks() {
  el.tasks.innerHTML = '';
  if (!state.tasks.length) {
    el.tasks.innerHTML = '<li class="empty">No requests yet. Use a quick action above.</li>';
    return;
  }
  for (const t of [...state.tasks].reverse()) {
    const li = document.createElement('li');
    const left = document.createElement('span');
    left.textContent = `${t.title} · ${t.agent}`;
    const pill = document.createElement('span');
    pill.className = `pill${t.status === 'Done' ? ' done' : ''}`;
    pill.textContent = t.status;
    li.append(left, pill); el.tasks.appendChild(li);
  }
}
function saveTasks() { localStorage.setItem('ua.tasks', JSON.stringify(state.tasks.slice(-30))); renderTasks(); }

function setMode(mode) {
  state.mode = mode; localStorage.setItem('ua.mode', mode);
  el.badge.textContent = mode === 'live' ? 'Live: Markus' : 'Demo mode';
  el.badge.className = `badge ${mode === 'live' ? 'badge-live' : 'badge-demo'}`;
}

/* ---------- Markus API (live mode) ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function connectLive(email, password, statusEl) {
  statusEl.textContent = 'Signing in…';
  await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  statusEl.textContent = 'Loading agents…';
  const data = await api('/api/agents');
  const existing = Array.isArray(data) ? data : data.agents || [];
  const missing = [];
  for (const a of AGENTS) {
    const hit = existing.find((x) => (x.name || '').toLowerCase() === a.name.toLowerCase());
    if (hit) state.liveAgents[a.key] = hit.id; else missing.push(a);
  }
  if (missing.length && confirm(`Create ${missing.length} missing agent(s) on your Markus server?\n\n${missing.map((m) => m.name).join('\n')}`)) {
    for (const a of missing) {
      const created = await api('/api/agents', { method: 'POST', body: JSON.stringify({ name: a.name, role: a.role, description: a.desc }) });
      state.liveAgents[a.key] = created.id || created.agent?.id;
    }
  }
  const ready = AGENTS.filter((a) => state.liveAgents[a.key]).length;
  if (!ready) throw new Error('No matching agents found on the server.');
  statusEl.textContent = `Connected. ${ready} of ${AGENTS.length} agents ready.`;
}

async function askLive(key, text) {
  const id = state.liveAgents[key];
  if (!id) throw new Error('This agent is not available on the server. Open Connection and reconnect.');
  const r = await api('/api/message', { method: 'POST', body: JSON.stringify({ targetAgentId: id, text }) });
  return r.reply || '(The agent returned no text.)';
}

/* ---------- Demo mode (scripted, with a little real logic) ---------- */
function demoReply(key, text) {
  if (key === 'registration' && /Courses requested/i.test(text)) return demoRegistration(text);
  if (key === 'report' && /Topic:/i.test(text)) return demoReport(text);
  const canned = {
    support: 'Good question. In demo mode I only have sample answers: the add/drop deadline is usually in week 2, tuition instalments can be requested from the Finance Office, and scholarship forms are due 1 March. Connect a live Markus server for answers based on your own university documents.',
    registration: 'Tell me which courses you want, or use the Course registration form, and I will check credits and timetable conflicts.',
    report: 'Use the "Write a report" form with your topic and requirements, and I will return an outline with a draft plan.',
    schedule: 'A solid weekly plan: Mon–Thu two 90-minute focus blocks per active course, Friday for review, weekend one catch-up block. Give me your deadlines and I will fit them in.',
  };
  return canned[key];
}

function demoRegistration(text) {
  const lines = text.split('\n').filter((l) => /^\s*-\s*[A-Z]{2}\d{3}/.test(l));
  const courses = lines.map((l) => ({
    raw: l.replace(/^\s*-\s*/, '').trim(),
    ects: +(l.match(/(\d+)\s*ECTS/) || [0, 0])[1],
    slot: (l.match(/ECTS,\s*([^)]+)\)/) || [0, ''])[1],
    code: (l.match(/[A-Z]{2}\d{3}/) || [''])[0],
  }));
  const total = courses.reduce((s, c) => s + c.ects, 0);
  const clashes = [];
  for (let i = 0; i < courses.length; i++)
    for (let j = i + 1; j < courses.length; j++)
      if (courses[i].slot && courses[i].slot === courses[j].slot) clashes.push(`${courses[i].code} and ${courses[j].code} both meet ${courses[i].slot}`);
  let out = `Registration check\n\nCourses: ${courses.map((c) => c.code).join(', ') || 'none'}\nTotal credits: ${total} ECTS (typical limit 30)\n\n`;
  out += clashes.length ? `Timetable conflicts:\n- ${clashes.join('\n- ')}\nChoose a different section or drop one of these courses.\n\n` : 'No timetable conflicts found.\n\n';
  out += total > 30 ? 'You are over the 30 ECTS limit and would need approval from your programme coordinator.' : total < 20 ? 'Under 20 ECTS may affect full-time status. Consider adding a course.' : 'Credit load looks fine.';
  return out + '\n\nStatus: ready to submit once you resolve any issues above.';
}

function demoReport(text) {
  const g = (k) => (text.match(new RegExp(`${k}:\\s*(.+)`, 'i')) || [0, '—'])[1].trim();
  return `Report plan: ${g('Topic')}\nType: ${g('Type')} · Length: ${g('Length')} · Style: ${g('Citation style')}\n\n1. Introduction: context, problem, thesis\n2. Background: key concepts and prior work\n3. Method or analysis: what you did and why\n4. Results or discussion: findings, limits\n5. Conclusion: answer the question, next steps\n6. References (${g('Citation style')})\n\nSuggested next step: ask me to draft section 1, and paste your marking criteria so I can match them.`;
}

/* ---------- Sending ---------- */
async function send(text, key = state.current) {
  addMsg('user', text, key);
  const typing = addMsg('agent', 'Thinking…', key); typing.typing = true;
  const node = key === state.current ? el.msgs.lastElementChild : null;
  el.send.disabled = true;
  try {
    const reply = state.mode === 'live' ? await askLive(key, text) : await new Promise((r) => setTimeout(() => r(demoReply(key, text)), 600));
    typing.text = reply; typing.typing = false;
    if (node) { node.textContent = reply; node.classList.remove('typing'); }
    return true;
  } catch (e) {
    typing.text = `Error: ${e.message}`; typing.typing = false;
    if (node) { node.textContent = typing.text; node.classList.remove('typing'); }
    return false;
  } finally { el.send.disabled = false; el.msgs.scrollTop = el.msgs.scrollHeight; }
}

async function submitRequest(key, title, prompt) {
  selectAgent(key);
  const t = { title, agent: AGENTS.find((a) => a.key === key).name, status: 'In progress' };
  state.tasks.push(t); saveTasks();
  const ok = await send(prompt, key);
  t.status = ok ? 'Done' : 'Failed'; saveTasks();
}

/* ---------- Events ---------- */
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.input.value.trim(); if (!text) return;
  el.input.value = ''; send(text);
});
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.form.requestSubmit(); }
});
$('#btn-clear').addEventListener('click', () => { state.history[state.current] = []; selectAgent(state.current); });

document.querySelectorAll('.action-card').forEach((c) => c.addEventListener('click', () => {
  const a = c.dataset.action;
  if (a === 'registration') $('#dlg-registration').showModal();
  else if (a === 'report') $('#dlg-report').showModal();
  else { selectAgent(a); el.input.focus(); }
}));

$('#form-registration').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  const f = new FormData(e.target);
  const courses = f.getAll('course');
  const prompt = `Please check my course registration.\nStudent ID: ${f.get('sid')}\nProgramme: ${f.get('programme')}\nSemester: ${f.get('semester')}\nCourses requested:\n${courses.map((c) => `- ${c}`).join('\n')}\nNotes: ${f.get('notes') || 'none'}\nCheck credits, prerequisites and timetable conflicts, then tell me whether I can submit.`;
  submitRequest('registration', `Registration ${f.get('semester')}`, prompt);
});

$('#form-report').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  const f = new FormData(e.target);
  const prompt = `Help me write a report.\nTopic: ${f.get('topic')}\nType: ${f.get('type')}\nLength: ${f.get('length')}\nCitation style: ${f.get('style')}\nRequirements: ${f.get('req') || 'none given'}\nGive me an outline first, then wait for my go-ahead to draft each section.`;
  submitRequest('report', `Report: ${f.get('topic')}`, prompt);
});

$('#btn-settings').addEventListener('click', () => {
  const f = $('#form-settings'); f.mode.value = state.mode; $('#dlg-settings').showModal();
});
$('#form-settings').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const f = e.target, status = $('#settings-status');
  try {
    if (f.mode.value === 'live') await connectLive(f.email.value, f.password.value, status);
    setMode(f.mode.value);
    if (f.mode.value === 'demo') status.textContent = 'Demo mode on.';
    else setTimeout(() => $('#dlg-settings').close(), 900);
  } catch (err) {
    status.textContent = `Could not connect: ${err.message}. Is Markus running (markus start) and is server.js running?`;
  }
});

/* ---------- Init ---------- */
setMode('demo'); // live mode needs a fresh sign-in each visit
renderAgents(); renderTasks(); selectAgent('support');
