import { randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import Fastify from 'fastify'
import { clearAllVisitors, dismissVisitor, getMonitoringSnapshot } from './lib/monitoring'
import { getRestartScriptPath, scheduleApiRestart } from './lib/schedule-api-restart'

const isAllowedHost = (host: string | undefined): boolean => {
  const normalizedHost = host?.trim().toLowerCase() ?? ''
  return (
    normalizedHost === '127.0.0.1' ||
    normalizedHost.startsWith('127.0.0.1:') ||
    normalizedHost === 'localhost' ||
    normalizedHost.startsWith('localhost:')
  )
}

const buildDashboardHtml = (nonce: string): string => `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>VidBee — мониторинг сервера</title>
  <style nonce="${nonce}">
    :root{font-family:Inter,Segoe UI,system-ui,sans-serif;color:#f7f8fb;background:#080b12;font-synthesis:none}
    *{box-sizing:border-box}
    body{margin:0;min-width:320px;background:radial-gradient(circle at 20% -10%,#17335e 0,transparent 32rem),#080b12;color:#f7f8fb}
    main{width:min(1400px,calc(100% - 32px));margin:0 auto;padding:28px 0 48px}
    header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
    h1{font-size:clamp(24px,4vw,38px);letter-spacing:-.04em;margin:0 0 7px}
    h2{font-size:17px;margin:0}
    p{margin:0;color:#95a0b4}
    .status{display:flex;align-items:center;gap:9px;padding:9px 13px;border:1px solid #263148;border-radius:999px;background:#101622;color:#b9c4d8;font-size:13px;white-space:nowrap}
    .dot{width:9px;height:9px;border-radius:50%;background:#38d996;box-shadow:0 0 14px #38d996}
    .dot.error{background:#ff667a;box-shadow:0 0 14px #ff667a}
    .grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:12px}
    .card,.panel{border:1px solid #202a3d;background:linear-gradient(145deg,rgba(18,25,39,.96),rgba(12,17,27,.96));box-shadow:0 18px 60px rgba(0,0,0,.16)}
    .card{border-radius:18px;padding:17px;min-height:116px}
    .card .label{font-size:12px;color:#8f9bb0;margin-bottom:19px}
    .card .value{font-size:27px;font-weight:700;letter-spacing:-.04em}
    .card .hint{font-size:11px;color:#69768c;margin-top:6px}
    .panel{border-radius:20px;padding:18px;margin-top:12px;overflow:hidden}
    .panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}
    .pill{padding:5px 9px;border-radius:999px;background:#192235;color:#9fb0ca;font-size:11px}
    .toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
    .filter-group{display:inline-flex;gap:6px}
    .filter-btn,.action-btn{border:1px solid #263148;border-radius:999px;background:#101622;color:#b9c4d8;font-size:11px;padding:6px 10px;cursor:pointer}
    .filter-btn.active{border-color:#3f6f9d;background:#152338;color:#eef4ff}
    .action-btn.danger{border-color:#5a2630;color:#ff9dac}
    .action-btn.warn{border-color:#5a4a20;color:#ffd27a;font-size:12px;padding:8px 12px}
    .action-btn:disabled{opacity:.45;cursor:not-allowed}
    .header-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-end}
    .queue{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}
    .queue div{padding:12px;border-radius:13px;background:#0a0f19;border:1px solid #1b2536}
    .queue strong{display:block;font-size:20px}
    .queue span{color:#8190a6;font-size:11px}
    .table-wrap{overflow:auto}
    table{width:100%;border-collapse:collapse;min-width:760px}
    th{text-align:left;color:#718097;font-size:10px;text-transform:uppercase;letter-spacing:.09em;font-weight:600;padding:0 10px 10px}
    td{border-top:1px solid #1c2637;padding:11px 10px;font-size:12px;color:#cbd3e1;vertical-align:middle}
    td.muted{color:#7f8da2}
    .state{display:inline-flex;align-items:center;gap:7px}
    .state:before{content:"";width:7px;height:7px;border-radius:50%;background:#59667a}
    .state.active:before,.state.completed:before{background:#38d996}
    .state.new:before{background:#c4a035}
    .state.running:before,.state.processing:before,.state.queued:before{background:#55a7ff}
    .state.failed:before,.state.error:before{background:#ff667a}
    .event-list{display:grid;gap:8px}
    .event{display:grid;grid-template-columns:90px 1fr auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid #1b2536;border-radius:12px;background:#0b101a;font-size:12px}
    .event.error{border-color:#4a2530}
    .event time,.event small{color:#718097}
    .empty{text-align:center;color:#68768b;padding:28px 12px;font-size:13px}
    .error-box{display:none;margin-bottom:12px;padding:12px 14px;border:1px solid #5a2630;border-radius:14px;background:#251119;color:#ff9dac;font-size:13px}
    @media(max-width:1100px){.grid{grid-template-columns:repeat(3,1fr)}}
    @media(max-width:650px){main{width:min(100% - 20px,1400px);padding-top:18px}header{display:block}.status{margin-top:14px;width:max-content}.grid{grid-template-columns:repeat(2,1fr)}.queue{grid-template-columns:repeat(2,1fr)}.event{grid-template-columns:70px 1fr}.event small{display:none}}
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>Мониторинг сервера</h1><p>Локальная панель VidBee · доступна только на этом компьютере</p></div>
      <div class="header-actions">
        <button type="button" class="action-btn warn" id="restart-server">Перезапустить сервер</button>
        <div class="status"><span class="dot" id="status-dot"></span><span id="status-text">Подключение…</span></div>
      </div>
    </header>
    <div class="error-box" id="error-box"></div>
    <section class="grid" aria-label="Основные показатели">
      <article class="card"><div class="label">Активны сейчас</div><div class="value" id="active-visitors">—</div><div class="hint">за последние 5 минут</div></article>
      <article class="card"><div class="label">Запросы</div><div class="value" id="requests">—</div><div class="hint">без polling и мониторинга</div></article>
      <article class="card"><div class="label">Загрузки сегодня</div><div class="value" id="completed">—</div><div class="hint" id="downloaded-bytes">—</div></article>
      <article class="card"><div class="label">Ошибки сегодня</div><div class="value" id="failed">—</div><div class="hint" id="http-errors">—</div></article>
      <article class="card"><div class="label">Память API</div><div class="value" id="memory">—</div><div class="hint">RSS процесса</div></article>
      <article class="card"><div class="label">Работает</div><div class="value" id="uptime">—</div><div class="hint" id="pid">—</div></article>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Очередь загрузок</h2><span class="pill" id="latency">—</span></div>
      <div class="queue">
        <div><strong id="queue-running">—</strong><span>Выполняется</span></div>
        <div><strong id="queue-waiting">—</strong><span>Ожидает</span></div>
        <div><strong id="queue-completed">—</strong><span>Завершено всего</span></div>
        <div><strong id="queue-failed">—</strong><span>Ошибок всего</span></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>Посетители</h2>
        <div class="toolbar">
          <div class="filter-group" role="group" aria-label="Фильтр посетителей">
            <button type="button" class="filter-btn active" data-visitor-filter="active">Активные</button>
            <button type="button" class="filter-btn" data-visitor-filter="new">Новые</button>
            <button type="button" class="filter-btn" data-visitor-filter="inactive">Неактивные</button>
            <button type="button" class="filter-btn" data-visitor-filter="all">Все</button>
          </div>
          <span class="pill" id="unique-visitors">—</span>
          <button type="button" class="action-btn danger" id="clear-visitors">Очистить всех</button>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Статус</th><th>IP</th><th>Страна</th><th>Сессия</th><th>Первый визит</th><th>Последняя активность</th><th>Запросы</th><th>Устройство</th><th></th></tr></thead>
        <tbody id="visitors-body"></tbody>
      </table></div>
      <div class="empty" id="visitors-empty">Посетителей пока нет</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Последние загрузки</h2><span class="pill">без сохранения ссылок</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Статус</th><th>Название</th><th>Прогресс</th><th>Размер</th><th>Обновлено</th></tr></thead>
        <tbody id="tasks-body"></tbody>
      </table></div>
      <div class="empty" id="tasks-empty">Загрузок пока нет</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Последние события</h2><span class="pill">до 100 записей</span></div>
      <div class="event-list" id="events"></div>
      <div class="empty" id="events-empty">Событий пока нет</div>
    </section>
  </main>
  <script nonce="${nonce}">
    const byId = (id) => document.getElementById(id);
    const setText = (id, value) => { byId(id).textContent = String(value); };
    const formatBytes = (bytes) => {
      if (!Number.isFinite(bytes) || bytes <= 0) return "0 Б";
      const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
      const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      return (bytes / 1024 ** index).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " " + units[index];
    };
    const formatTime = (timestamp) => timestamp ? new Date(timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
    const formatDuration = (seconds) => {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (days > 0) return days + " д " + hours + " ч";
      if (hours > 0) return hours + " ч " + minutes + " мин";
      return Math.max(0, minutes) + " мин";
    };
    const createCell = (text, className) => {
      const cell = document.createElement("td");
      cell.textContent = text == null || text === "" ? "—" : String(text);
      if (className) cell.className = className;
      return cell;
    };
    const statusLabels = { queued:"В очереди",running:"Запуск",processing:"Скачивается",paused:"Пауза","retry-scheduled":"Повтор",completed:"Готово",failed:"Ошибка",cancelled:"Отменено" };
    let visitorFilter = "active";
    let latestVisitors = [];
    const filterVisitors = (visitors) => {
      if (visitorFilter === "active") return visitors.filter((visitor) => visitor.active);
      if (visitorFilter === "new") {
        return visitors
          .filter((visitor) => visitor.isNew)
          .sort((left, right) => right.firstSeen - left.firstSeen);
      }
      if (visitorFilter === "inactive") {
        return visitors.filter((visitor) => !visitor.active && !visitor.isNew);
      }
      return visitors;
    };
    const formatVisitorStatus = (visitor) => {
      if (visitor.isNew) {
        if (visitor.currentRequests > 0) return "Новый · подключён";
        if (visitor.active) return "Новый · недавно";
        return "Новый";
      }
      if (visitor.currentRequests > 0) return "Подключён";
      if (visitor.active) return "Недавно";
      return "Неактивен";
    };
    const setVisitorFilter = (nextFilter) => {
      visitorFilter = nextFilter;
      for (const button of document.querySelectorAll("[data-visitor-filter]")) {
        button.classList.toggle("active", button.getAttribute("data-visitor-filter") === nextFilter);
      }
      renderVisitors(latestVisitors);
    };
    const dismissVisitor = async (key) => {
      const response = await fetch("/api/visitors?key=" + encodeURIComponent(key), { method: "DELETE" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      latestVisitors = latestVisitors.filter((visitor) => visitor.key !== key);
      renderVisitors(latestVisitors);
    };
    const clearVisitors = async () => {
      if (!window.confirm("Удалить все записи о посетителях?")) return;
      const response = await fetch("/api/visitors", { method: "DELETE" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      latestVisitors = [];
      renderVisitors(latestVisitors);
    };
    const renderVisitors = (visitors) => {
      latestVisitors = visitors;
      const visibleVisitors = filterVisitors(visitors);
      const body = byId("visitors-body");
      body.replaceChildren();
      byId("visitors-empty").style.display = visibleVisitors.length ? "none" : "block";
      byId("visitors-empty").textContent = visitorFilter === "active"
        ? "Активных посетителей сейчас нет"
        : visitorFilter === "new"
          ? "Новых посетителей пока нет"
        : visitorFilter === "inactive"
          ? "Неактивных посетителей нет"
          : "Посетителей пока нет";
      for (const visitor of visibleVisitors) {
        const row = document.createElement("tr");
        const stateCell = document.createElement("td");
        const state = document.createElement("span");
        state.className = "state" + (visitor.isNew ? " new" : visitor.active ? " active" : "");
        state.textContent = formatVisitorStatus(visitor);
        stateCell.append(state);
        const actionCell = document.createElement("td");
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "action-btn danger";
        removeButton.textContent = "Удалить";
        removeButton.addEventListener("click", () => {
          removeButton.disabled = true;
          dismissVisitor(visitor.key).catch((error) => {
            removeButton.disabled = false;
            const box = byId("error-box");
            box.textContent = "Не удалось удалить посетителя: " + (error instanceof Error ? error.message : "неизвестная ошибка");
            box.style.display = "block";
          });
        });
        actionCell.append(removeButton);
        row.append(stateCell, createCell(visitor.ip), createCell(visitor.country), createCell(visitor.session), createCell(formatTime(visitor.firstSeen)), createCell(formatTime(visitor.lastSeen)), createCell(visitor.requests), createCell(visitor.userAgent, "muted"), actionCell);
        body.append(row);
      }
    };
    const renderTasks = (tasks) => {
      const body = byId("tasks-body");
      body.replaceChildren();
      byId("tasks-empty").style.display = tasks.length ? "none" : "block";
      for (const task of tasks) {
        const row = document.createElement("tr");
        const stateCell = document.createElement("td");
        const state = document.createElement("span");
        state.className = "state " + task.status;
        state.textContent = statusLabels[task.status] || task.status;
        stateCell.append(state);
        const percent = Number.isFinite(task.percent) ? Math.round(task.percent * 100) + "%" : "—";
        row.append(stateCell, createCell(task.title), createCell(percent), createCell(formatBytes(task.size)), createCell(formatTime(task.updatedAt)));
        body.append(row);
      }
    };
    const renderEvents = (events) => {
      const container = byId("events");
      container.replaceChildren();
      byId("events-empty").style.display = events.length ? "none" : "block";
      for (const event of events.slice(0, 30)) {
        const item = document.createElement("div");
        item.className = "event " + event.kind;
        const time = document.createElement("time");
        time.textContent = formatTime(event.at);
        const title = document.createElement("span");
        title.textContent = event.title;
        const detail = document.createElement("small");
        detail.textContent = event.detail;
        item.append(time, title, detail);
        container.append(item);
      }
    };
    const render = (data) => {
      setText("active-visitors", data.traffic.activeVisitors);
      setText("requests", data.traffic.totalRequests.toLocaleString("ru-RU"));
      setText("completed", data.queue.today.completed);
      setText("downloaded-bytes", formatBytes(data.queue.today.downloadedBytes) + " скачано");
      setText("failed", data.queue.today.failed);
      setText("http-errors", data.traffic.errorResponses + " серверных HTTP-ошибок");
      setText("memory", formatBytes(data.server.memory.rss));
      setText("uptime", formatDuration(data.server.uptimeSeconds));
      setText("pid", "PID " + data.server.pid + " · Node " + data.server.nodeVersion);
      setText("queue-running", data.queue.running);
      setText("queue-waiting", data.queue.queued);
      setText("queue-completed", data.queue.byStatus.completed);
      setText("queue-failed", data.queue.byStatus.failed);
      setText("latency", "средний ответ " + Math.round(data.traffic.averageLatencyMs) + " мс");
      setText("unique-visitors", data.traffic.newVisitors + " новых · " + data.traffic.activeVisitors + " активных · " + data.traffic.uniqueVisitors + " всего");
      setText("status-text", "Работает · обновлено " + formatTime(data.generatedAt));
      byId("status-dot").className = "dot";
      byId("error-box").style.display = "none";
      renderVisitors(data.traffic.visitors);
      renderTasks(data.queue.recentTasks);
      renderEvents(data.events);
    };
    const refresh = async () => {
      try {
        const response = await fetch("/api/snapshot", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        render(await response.json());
      } catch (error) {
        byId("status-dot").className = "dot error";
        setText("status-text", "Нет связи с панелью");
        const box = byId("error-box");
        box.textContent = "Не удалось обновить данные: " + (error instanceof Error ? error.message : "неизвестная ошибка");
        box.style.display = "block";
      }
    };
    for (const button of document.querySelectorAll("[data-visitor-filter]")) {
      button.addEventListener("click", () => {
        setVisitorFilter(button.getAttribute("data-visitor-filter"));
      });
    }
    byId("clear-visitors").addEventListener("click", () => {
      clearVisitors().catch((error) => {
        const box = byId("error-box");
        box.textContent = "Не удалось очистить посетителей: " + (error instanceof Error ? error.message : "неизвестная ошибка");
        box.style.display = "block";
      });
    });
    byId("restart-server").addEventListener("click", () => {
      const button = byId("restart-server");
      if (button.disabled) return;
      const confirmed = window.confirm("Перезапустить API-сервер?\\nТуннель не трогаем. Панель на пару секунд пропадёт.");
      if (!confirmed) return;
      button.disabled = true;
      button.textContent = "Перезапуск…";
      fetch("/api/restart", { method: "POST" })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || "HTTP " + response.status);
          }
          setText("status-text", "Сервер перезапускается…");
          byId("status-dot").className = "dot error";
        })
        .catch((error) => {
          button.disabled = false;
          button.textContent = "Перезапустить сервер";
          const box = byId("error-box");
          box.textContent = "Не удалось перезапустить: " + (error instanceof Error ? error.message : "неизвестная ошибка");
          box.style.display = "block";
        });
    });
    void refresh();
    window.setInterval(refresh, 2000);
  </script>
</body>
</html>`

export const createAdminServer = () => {
  const admin = Fastify({ logger: false })

  admin.addHook('onRequest', async (request, reply) => {
    if (!isAllowedHost(request.headers.host)) {
      return reply.code(403).send({ message: 'Local access only.' })
    }
  })

  admin.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    return payload
  })

  admin.get('/health', async () => ({ ok: true }))
  admin.get('/api/snapshot', async () => getMonitoringSnapshot())
  admin.post('/api/restart', async (_request, reply) => {
    try {
      const scriptPath = getRestartScriptPath()
      await access(scriptPath)
      // Delay so the HTTP response can leave before ports are stopped.
      setTimeout(() => {
        void scheduleApiRestart().catch((error) => {
          console.error('Failed to schedule API restart:', error)
        })
      }, 400)
      return {
        ok: true,
        message: 'API restart scheduled. Tunnel is left running.',
        scriptPath
      }
    } catch (error) {
      return reply.code(500).send({
        message:
          error instanceof Error
            ? error.message
            : 'Failed to schedule restart.'
      })
    }
  })
  admin.delete<{ Querystring: { key?: string } }>('/api/visitors', async (request, reply) => {
    const key = request.query.key?.trim()
    if (!key) {
      return { ok: true, removed: clearAllVisitors() }
    }
    if (!dismissVisitor(key)) {
      return reply.code(404).send({ message: 'Visitor not found.' })
    }
    return { ok: true, removed: 1 }
  })
  admin.get('/favicon.ico', async (_request, reply) => reply.code(204).send())
  admin.get('/', async (_request, reply) => {
    const nonce = randomBytes(18).toString('base64')
    reply.header(
      'Content-Security-Policy',
      `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
    )
    reply.type('text/html; charset=utf-8')
    return buildDashboardHtml(nonce)
  })

  return admin
}
