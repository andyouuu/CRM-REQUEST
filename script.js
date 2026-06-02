(function () {
  'use strict';

  const form = document.getElementById('request-form');
  const tbody = document.getElementById('requests-body');
  const searchInput = document.getElementById('search');
  const statusEl = document.getElementById('status');
  const formStatusEl = document.getElementById('form-status');
  const filterHint = document.getElementById('filter-hint');
  const saveBtn = document.getElementById('save-btn');
  const saveBtnLabel = saveBtn.querySelector('.btn__label');
  const sortSelect = document.getElementById('sort-order');
  const statTotal = document.getElementById('stat-total');
  const statToday = document.getElementById('stat-today');
  const statWeek = document.getElementById('stat-week');
  const deleteDialog = document.getElementById('delete-dialog');
  const deleteCancel = document.getElementById('delete-cancel');
  const deleteConfirm = document.getElementById('delete-confirm');

  let allRequests = [];
  let searchQuery = '';
  let sortOrder = 'desc';
  let pendingDeleteId = null;

  function getConfig() {
    return window.CONFIG || null;
  }

  function apiUrl() {
    const cfg = getConfig();
    if (!cfg) {
      throw new Error(
        'Не найден config.js. Откройте сайт из папки проекта (рядом должны лежать config.js и index.html) или через GitHub Pages.'
      );
    }

    const url = (cfg.API_URL || '').trim();
    if (!url || url.includes('YOUR_SCRIPT_ID')) {
      throw new Error(
        'В config.js укажите API_URL — URL веб-приложения Apps Script (Развернуть → Веб-приложение, заканчивается на /exec). Сохраните файл и обновите страницу (Cmd+Shift+R).'
      );
    }
    if (!url.startsWith('https://script.google.com/macros/s/')) {
      throw new Error('API_URL должен начинаться с https://script.google.com/macros/s/ … /exec');
    }
    return url;
  }

  function setStatus(message, type, target) {
    const el = target === 'form' ? formStatusEl : statusEl;
    if (!el) return;
    el.textContent = message || '';
    el.className = 'status' + (type ? ' status--' + type : '');
  }

  /**
   * Google Apps Script из браузера надёжно отвечает на GET.
   * POST часто ломается из‑за редиректа 302 → HTML «Page not found».
   */
  async function apiCall(payload) {
    const params = new URLSearchParams();
    params.set('action', payload.action);

    if (payload.action === 'create') {
      params.set('name', payload.name || '');
      params.set('phone', payload.phone || '');
      params.set('comment', payload.comment || '');
    }
    if (payload.action === 'delete') {
      params.set('id', payload.id || '');
    }

    const url = apiUrl() + '?' + params.toString();
    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
      controller.abort();
    }, 45000);

    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Сервер не ответил вовремя. Проверьте URL в config.js и развертывание Apps Script.');
      }
      throw new Error(
        'Нет связи с сервером. Откройте сайт через GitHub Pages (не как локальный файл) и проверьте API_URL.'
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      if (text.indexOf('Page not found') !== -1) {
        throw new Error(
          'Веб-приложение не найдено. Обновите развертывание Apps Script и URL в config.js.'
        );
      }
      throw new Error('Некорректный ответ сервера. Проверьте развертывание Apps Script.');
    }

    if (!data.ok) {
      throw new Error(data.error || 'Ошибка сервера');
    }
    return data;
  }

  function parseCreatedAt(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isValidRequest(r) {
    return !!(r && r.id && String(r.id).trim());
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function computeStats() {
    const valid = allRequests.filter(isValidRequest);
    const now = new Date();
    const todayStart = startOfLocalDay(now);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);

    let today = 0;
    let week = 0;

    valid.forEach(function (r) {
      const created = parseCreatedAt(r.createdAt);
      if (!created) return;
      if (created >= todayStart) today++;
      if (created >= weekStart) week++;
    });

    return { total: valid.length, today: today, week: week };
  }

  function updateStats() {
    const stats = computeStats();
    statTotal.textContent = String(stats.total);
    statToday.textContent = String(stats.today);
    statWeek.textContent = String(stats.week);
  }

  function formatDate(iso) {
    const date = parseCreatedAt(iso);
    if (!date) return iso ? String(iso) : '—';
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function sortByDate(list) {
    return list.slice().sort(function (a, b) {
      const ta = parseCreatedAt(a.createdAt);
      const tb = parseCreatedAt(b.createdAt);
      const timeA = ta ? ta.getTime() : 0;
      const timeB = tb ? tb.getTime() : 0;
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function filteredRequests() {
    const q = searchQuery.trim().toLowerCase();
    let list = allRequests.filter(isValidRequest);
    if (q) {
      list = list.filter(function (r) {
        return r.name.toLowerCase().includes(q);
      });
    }
    return sortByDate(list);
  }

  function renderTable() {
    const list = filteredRequests();
    updateStats();
    const q = searchQuery.trim();

    if (list.length === 0) {
      const message = q
        ? 'По запросу «' + escapeHtml(q) + '» ничего не найдено'
        : allRequests.length === 0
          ? 'Заявок пока нет — создайте первую'
          : 'Нет заявок для отображения';
      tbody.innerHTML =
        '<tr class="table__empty"><td colspan="5">' + message + '</td></tr>';
      filterHint.hidden = !q || allRequests.length === 0;
      filterHint.textContent = q
        ? 'Показано 0 из ' + allRequests.length
        : '';
      return;
    }

    tbody.innerHTML = list
      .map(function (r) {
        return (
          '<tr data-id="' +
          escapeHtml(r.id) +
          '">' +
          '<td data-label="Имя">' +
          escapeHtml(r.name) +
          '</td>' +
          '<td data-label="Телефон">' +
          escapeHtml(r.phone) +
          '</td>' +
          '<td class="table__comment" data-label="Комментарий">' +
          escapeHtml(r.comment || '—') +
          '</td>' +
          '<td data-label="Дата создания">' +
          escapeHtml(formatDate(r.createdAt)) +
          '</td>' +
          '<td class="table__cell-actions" data-label="">' +
          '<button type="button" class="btn btn--danger btn-delete" data-id="' +
          escapeHtml(r.id) +
          '">Удалить</button>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    filterHint.hidden = !q;
    filterHint.textContent = q
      ? 'Показано ' + list.length + ' из ' + allRequests.length
      : '';
  }

  async function loadRequests() {
    setStatus('Загрузка…', 'info');
    const data = await apiCall({ action: 'list' });
    allRequests = (data.requests || []).filter(isValidRequest);
    renderTable();
    setStatus('');
  }

  async function createRequest(formData) {
    const data = await apiCall({
      action: 'create',
      name: formData.get('name'),
      phone: formData.get('phone'),
      comment: formData.get('comment'),
    });
    if (data.request) {
      allRequests.unshift(data.request);
      renderTable();
      if (data.request.telegram && !data.request.telegram.ok) {
        return data.request.telegram;
      }
    }
    return { ok: true };
  }

  async function deleteRequest(id) {
    await apiCall({ action: 'delete', id: id });
    allRequests = allRequests.filter(function (r) {
      return r.id !== id;
    });
    renderTable();
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!form.reportValidity()) return;

    saveBtn.disabled = true;
    if (saveBtnLabel) saveBtnLabel.textContent = 'Сохранение…';
    setStatus('Сохранение…', 'info', 'form');

    try {
      const fd = new FormData(form);
      const telegramResult = await createRequest(fd);
      form.reset();
      if (telegramResult && !telegramResult.ok) {
        setStatus(
          'Заявка в таблице сохранена, но Telegram: ' + telegramResult.message,
          'error',
          'form'
        );
      } else {
        setStatus('Заявка сохранена', 'success', 'form');
      }
      setTimeout(function () {
        if (formStatusEl.textContent === 'Заявка сохранена') setStatus('', '', 'form');
      }, 4000);
    } catch (err) {
      setStatus(err.message || 'Не удалось сохранить', 'error', 'form');
    } finally {
      saveBtn.disabled = false;
      if (saveBtnLabel) saveBtnLabel.textContent = 'Сохранить';
    }
  });

  searchInput.addEventListener('input', function () {
    searchQuery = searchInput.value;
    renderTable();
  });

  sortSelect.addEventListener('change', function () {
    sortOrder = sortSelect.value === 'asc' ? 'asc' : 'desc';
    renderTable();
  });

  function openDeleteDialog(id) {
    pendingDeleteId = id;
    if (deleteDialog.showModal) {
      deleteDialog.showModal();
    } else if (window.confirm('Вы уверены?')) {
      runDelete(id);
    }
  }

  function closeDeleteDialog() {
    pendingDeleteId = null;
    if (deleteDialog.open) deleteDialog.close();
  }

  async function runDelete(id) {
    setStatus('Удаление…', 'info');

    try {
      await deleteRequest(id);
      setStatus('Заявка удалена', 'success');
      setTimeout(function () {
        if (statusEl.textContent === 'Заявка удалена') setStatus('');
      }, 2500);
    } catch (err) {
      setStatus(err.message || 'Не удалось удалить', 'error');
    }
  }

  deleteCancel.addEventListener('click', closeDeleteDialog);

  deleteDialog.addEventListener('close', function () {
    pendingDeleteId = null;
  });

  deleteDialog.querySelector('form').addEventListener('submit', function (e) {
    e.preventDefault();
    const id = pendingDeleteId;
    closeDeleteDialog();
    if (id) runDelete(id);
  });

  tbody.addEventListener('click', function (e) {
    const btn = e.target.closest('.btn-delete');
    if (!btn) return;

    const id = btn.dataset.id;
    if (!id) return;
    openDeleteDialog(id);
  });

  loadRequests().catch(function (err) {
    setStatus(err.message || 'Не удалось загрузить заявки', 'error');
    tbody.innerHTML =
      '<tr class="table__empty"><td colspan="5">Ошибка загрузки</td></tr>';
    updateStats();
  });
})();
