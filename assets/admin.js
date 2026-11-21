(function () {
  'use strict';

  var KINDS = [
    { kind: 'label', name: 'Текст', ic: 'T', props: ['text', 'size'] },
    { kind: 'edit', name: 'Строка', ic: 'Ab', props: ['placeholder', 'max', 'value'] },
    { kind: 'memo', name: 'Абзац', ic: '¶', props: ['placeholder', 'max', 'value'] },
    { kind: 'combo', name: 'Выбор', ic: '▾', props: ['options', 'value'] },
    { kind: 'check', name: 'Флажок', ic: '☑', props: [] },
    { kind: 'button', name: 'Кнопка', ic: '⚡', props: ['primary'] },
    { kind: 'image', name: 'Картинка', ic: '▣', props: [] },
    { kind: 'gallery', name: 'Галерея', ic: '▦', props: ['limit', 'empty'] },
    { kind: 'list', name: 'Список', ic: '≡', props: ['empty'] },
    { kind: 'status', name: 'Статус', ic: '◉', props: [] }
  ];

  var EVENTS = {
    edit: ['on_change'],
    memo: ['on_change'],
    combo: ['on_change'],
    check: ['on_change'],
    button: ['on_click']
  };

  var VALUE_KINDS = ['edit', 'memo', 'combo', 'check', 'image', 'gallery', 'status'];
  var SNAP = 8;

  var state = { slug: null, form: null, selected: null, dirty: false, dragging: false, hasDraft: false };
  var history = [];
  var HISTORY_LIMIT = 20;
  var armSnapshot = true;

  function snapshot() {
    if (!state.form) return;
    var json = JSON.stringify(state.form);
    if (history.length && history[history.length - 1] === json) return;
    history.push(json);
    if (history.length > HISTORY_LIMIT) history.shift();
  }

  function undo() {
    if (!history.length) {
      setStatus('нечего отменять');
      return;
    }
    state.form = JSON.parse(history.pop());
    var exists = state.form.elements.some(function (el) { return el.id === state.selected; });
    if (!exists) {
      state.selected = state.form.elements.length ? state.form.elements[0].id : null;
    }
    renderAll();
    markDirty();
    setStatus('отменено');
  }

  var $ = function (sel) { return document.querySelector(sel); };
  var select = $('#form-select');
  var status = $('#status');
  var saveBtn = $('#save');
  var publishBtn = $('#publish');
  var draftBadge = $('#draft-badge');
  var openLink = $('#open');
  var previewLink = $('#preview');
  var canvas = $('#canvas');
  var palette = $('#palette');
  var inspector = $('#inspector');

  function snap(value) {
    return Math.round(value / SNAP) * SNAP;
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = kind || '';
  }

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      var type = res.headers.get('content-type') || '';
      var body = type.indexOf('json') >= 0 ? res.json() : res.text();
      return body.then(function (data) {
        if (!res.ok) {
          var message = data && data.error ? data.error : 'HTTP ' + res.status;
          if (data && data.issues) message += ': ' + data.issues.join('; ');
          throw new Error(message);
        }
        return data;
      });
    });
  }

  function markDirty() {
    state.dirty = true;
    setStatus('есть несохранённые правки');
  }

  function syncDraft() {
    draftBadge.hidden = !state.hasDraft;
  }

  function syncOption() {
    var option = select.querySelector('option[value="' + state.slug + '"]');
    if (option && state.form) option.textContent = state.form.title + ' (' + state.slug + ')';
  }

  function selected() {
    if (!state.form || !state.selected) return null;
    for (var i = 0; i < state.form.elements.length; i++) {
      if (state.form.elements[i].id === state.selected) return state.form.elements[i];
    }
    return null;
  }

  // --- загрузка списка страниц -------------------------------------------------

  function loadForms() {
    return api('/api/v1/admin/forms').then(function (data) {
      select.innerHTML = '';
      data.forms.forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.slug;
        option.textContent = item.title + ' (' + item.slug + ')';
        select.appendChild(option);
      });
      var wanted = state.slug || data.forms[0].slug;
      if (!data.forms.some(function (f) { return f.slug === wanted; })) wanted = data.forms[0].slug;
      select.value = wanted;
      return loadForm(wanted);
    });
  }

  function loadForm(slug) {
    return api('/api/v1/admin/forms/' + slug).then(function (data) {
      state.slug = slug;
      state.form = data.form;
      state.selected = data.form.elements.length ? data.form.elements[0].id : null;
      state.dirty = false;
      state.hasDraft = Boolean(data.hasDraft);
      history.length = 0;
      openLink.href = '/p/' + slug;
      previewLink.href = '/p/' + slug + '?draft=1';
      renderAll();
      syncDraft();
      setStatus(
        state.hasDraft
          ? 'черновик отличается от опубликованной страницы'
          : 'загружено: ' + slug + ' · элементов ' + state.form.elements.length
      );
    });
  }

  // --- палитра ----------------------------------------------------------------

  function renderPalette() {
    palette.innerHTML = KINDS.map(function (item) {
      return (
        '<button data-kind="' + item.kind + '"><span class="ic">' + item.ic + '</span>' +
        '<span>' + item.name + '<span class="hint">' + item.kind + '</span></span></button>'
      );
    }).join('');
  }

  // --- канвас -----------------------------------------------------------------

  function preview(el) {
    var p = el.props || {};
    var label = el.label ? '<div class="cap">' + escapeHtml(el.label) + '</div>' : '';
    switch (el.kind) {
      case 'label':
        return '<div class="box">' + escapeHtml(p.text || el.label || 'Текст') + '</div>';
      case 'edit':
        return label + '<div class="box">' + escapeHtml(p.placeholder || 'строка ввода') + '</div>';
      case 'memo':
        return label + '<div class="box">' + escapeHtml(p.placeholder || 'многострочный текст') + '</div>';
      case 'combo':
        return label + '<div class="box">▾ ' + escapeHtml((p.options || [])[0] || 'варианты') + '</div>';
      case 'check':
        return '<div class="box">☑ ' + escapeHtml(el.label || 'флажок') + '</div>';
      case 'button':
        return '<div class="box btnbox">' + escapeHtml(el.label || 'Кнопка') + '</div>';
      case 'image':
        return label + '<div class="box">картинка</div>';
      case 'gallery':
        return label + '<div class="box galbox"><i></i><i></i><i></i></div>';
      case 'list':
        return label + '<div class="box" style="display:block;text-align:left">• строка<br>• строка<br>• строка</div>';
      case 'status':
        return '<div class="box badgebox">◉ статус</div>';
      default:
        return '<div class="box">' + el.kind + '</div>';
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderCanvas() {
    if (!state.form) return;
    canvas.style.width = state.form.canvas.width + 'px';
    var bottom = 320;
    state.form.elements.forEach(function (el) {
      bottom = Math.max(bottom, el.y + el.h);
    });
    canvas.style.height = bottom + 160 + 'px';
    canvas.innerHTML = '';
    state.form.elements.forEach(function (el) {
      var node = document.createElement('div');
      node.className = 'el' + (el.id === state.selected ? ' sel' : '');
      node.dataset.id = el.id;
      node.style.cssText =
        'left:' + el.x + 'px;top:' + el.y + 'px;width:' + el.w + 'px;height:' + el.h + 'px';
      node.innerHTML = preview(el) + '<i class="handle" title="потянуть за угол"></i>';
      bindDrag(node, el);
      bindResize(node.querySelector('.handle'), node, el);
      canvas.appendChild(node);
    });
  }

  function bindDrag(node, el) {
    node.addEventListener('pointerdown', function (event) {
      if (event.target.classList.contains('handle')) return;
      event.preventDefault();
      snapshot();
      state.selected = el.id;
      renderSelection();
      renderInspector();

      var startX = event.clientX;
      var startY = event.clientY;
      var originX = el.x;
      var originY = el.y;
      var moved = false;
      state.dragging = true;
      node.setPointerCapture(event.pointerId);

      function move(moveEvent) {
        var dx = moveEvent.clientX - startX;
        var dy = moveEvent.clientY - startY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
        var maxX = state.form.canvas.width - el.w;
        el.x = Math.max(0, Math.min(maxX, snap(originX + dx)));
        el.y = Math.max(0, snap(originY + dy));
        node.style.left = el.x + 'px';
        node.style.top = el.y + 'px';
        updateRectInputs(el);
      }

      function up() {
        state.dragging = false;
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
        node.removeEventListener('pointercancel', up);
        if (moved) markDirty();
        else history.pop();
      }

      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    });
  }

  function bindResize(handle, node, el) {
    handle.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      event.stopPropagation();
      snapshot();
      var startX = event.clientX;
      var startY = event.clientY;
      var originW = el.w;
      var originH = el.h;
      var moved = false;
      state.dragging = true;
      handle.setPointerCapture(event.pointerId);

      function move(moveEvent) {
        var dx = moveEvent.clientX - startX;
        var dy = moveEvent.clientY - startY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
        var maxW = state.form.canvas.width - el.x;
        el.w = Math.max(64, Math.min(maxW, snap(originW + dx)));
        el.h = Math.max(24, snap(originH + dy));
        node.style.width = el.w + 'px';
        node.style.height = el.h + 'px';
        updateRectInputs(el);
      }

      function up() {
        state.dragging = false;
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        if (moved) markDirty();
        else history.pop();
      }

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function renderSelection() {
    Array.prototype.forEach.call(canvas.children, function (node) {
      node.classList.toggle('sel', node.dataset.id === state.selected);
    });
  }

  function renderAll() {
    renderCanvas();
    renderInspector();
  }

  // --- добавление и удаление ---------------------------------------------------

  function nextId(kind) {
    var taken = {};
    state.form.elements.forEach(function (el) { taken[el.id] = true; });
    Object.keys(state.form.aliases || {}).forEach(function (from) { taken[from] = true; });
    if (!taken[kind]) return kind;
    var n = 2;
    while (taken[kind + n]) n++;
    return kind + n;
  }

  function defaultProps(kind) {
    if (kind === 'label') return { text: 'Заголовок', size: 'l' };
    if (kind === 'edit' || kind === 'memo') return { placeholder: '', max: 800 };
    if (kind === 'combo') return { options: ['Вариант 1', 'Вариант 2'] };
    if (kind === 'button') return { primary: true };
    if (kind === 'gallery') return { limit: 12, empty: 'Пока пусто' };
    if (kind === 'list') return { empty: 'Пока пусто' };
    return {};
  }

  function defaultSize(kind) {
    if (kind === 'button') return { w: 200, h: 48 };
    if (kind === 'image') return { w: 320, h: 320 };
    if (kind === 'gallery') return { w: 360, h: 320 };
    if (kind === 'list') return { w: 360, h: 200 };
    if (kind === 'label') return { w: 400, h: 48 };
    if (kind === 'status') return { w: 220, h: 32 };
    if (kind === 'check') return { w: 240, h: 32 };
    return { w: 320, h: 40 };
  }

  function addElement(kind) {
    if (!state.form) return;
    snapshot();
    var size = defaultSize(kind);
    var bottom = 16;
    state.form.elements.forEach(function (el) { bottom = Math.max(bottom, el.y + el.h); });
    var y = Math.min(bottom + 12, 4000 - size.h);
    var id = nextId(kind);
    var el = {
      id: id,
      kind: kind,
      x: 40,
      y: y,
      w: size.w,
      h: size.h,
      label: kind === 'label' ? '' : KINDS.filter(function (k) { return k.kind === kind; })[0].name,
      hidden: false,
      props: defaultProps(kind)
    };
    if (kind === 'button') el.label = 'Кнопка';
    if (kind === 'status') el.label = '';
    if (kind === 'image') el.label = 'Картинка';
    if (kind === 'gallery') el.label = 'Галерея';
    state.form.elements.push(el);
    state.selected = id;
    renderCanvas();
    renderInspector();
    markDirty();
    setStatus('добавлен элемент «' + id + '» · метод ' + state.slug + '.' + id);
  }

  function removeSelected() {
    var el = selected();
    if (!el) return;
    snapshot();
    state.form.elements = state.form.elements.filter(function (item) { return item.id !== el.id; });
    state.selected = state.form.elements.length ? state.form.elements[0].id : null;
    renderCanvas();
    renderInspector();
    markDirty();
  }

  // --- инспектор ---------------------------------------------------------------

  function aliasesOf(id) {
    var aliases = state.form.aliases || {};
    return Object.keys(aliases).filter(function (from) {
      return aliases[from] === id;
    });
  }

  function methodsFor(el) {    var list = [];
    var base = state.slug + '.' + el.id;
    if (VALUE_KINDS.indexOf(el.kind) >= 0) {
      list.push({ name: base, kind: 'get', title: 'прочитать' });
      list.push({ name: state.slug + '.post_' + el.id, kind: 'post', title: 'записать' });
    }
    (EVENTS[el.kind] || []).forEach(function (event) {
      list.push({ name: state.slug + '.' + event + '_' + el.id, kind: 'event', title: 'событие' });
    });
    return list;
  }

  function row(label, input) {
    return '<div class="row"><label>' + label + '</label>' + input + '</div>';
  }

  function textInput(prop, value, placeholder) {
    return '<input type="text" data-prop="' + prop + '" value="' + escapeHtml(value == null ? '' : value) + '" placeholder="' + escapeHtml(placeholder || '') + '">';
  }

  function numberInput(prop, value) {
    return '<input type="number" data-prop="' + prop + '" value="' + (value == null ? 0 : value) + '" min="0" step="8">';
  }

  function renderInspector() {
    var el = selected();
    if (!el) {
      inspector.innerHTML = '<h3>Инспектор</h3><div class="empty">Выбери элемент на канвасе или добавь из палитры.</div>';
      return;
    }

    var html = '<h3>Элемент</h3>';
    html += row('id', '<input type="text" data-prop="id" value="' + escapeHtml(el.id) + '" title="имя элемента = имя метода; переименование меняет контракт с n8n">');
    html += '<div class="muted" style="padding:0 14px 8px">метод: ' + escapeHtml(state.slug) + '.<b>' + escapeHtml(el.id) + '</b></div>';
    html += row('вид', '<input type="text" value="' + el.kind + '" disabled>');
    if (el.kind !== 'status') html += row('подпись', textInput('label', el.label));
    html += '<div class="row pair"><label>прямоуг.</label>' + numberInput('x', el.x) + numberInput('y', el.y) + '</div>';
    html += '<div class="row pair"><label>размер</label>' + numberInput('w', el.w) + numberInput('h', el.h) + '</div>';

    var props = KINDS.filter(function (k) { return k.kind === el.kind; })[0].props;
    if (props.length) {
      html += '<h3>Свойства</h3>';
      if (props.indexOf('text') >= 0) html += row('текст', textInput('p:text', el.props.text, 'что показать'));
      if (props.indexOf('size') >= 0) {
        html += row(
          'кегль',
          '<select data-prop="p:size">' +
            ['s', 'm', 'l', 'xl'].map(function (size) {
              return '<option value="' + size + '"' + (el.props.size === size ? ' selected' : '') + '>' + size + '</option>';
            }).join('') +
          '</select>'
        );
      }
      if (props.indexOf('placeholder') >= 0) html += row('подсказка', textInput('p:placeholder', el.props.placeholder, 'серый текст в поле'));
      if (props.indexOf('value') >= 0) html += row('значение', textInput('p:value', el.props.value, 'по умолчанию'));
      if (props.indexOf('max') >= 0) html += row('лимит', numberInput('p:max', el.props.max));
      if (props.indexOf('options') >= 0) {
        var optionsValue = (el.props.options || []).join('\n');
        html += '<div class="row"><label>варианты</label><textarea data-prop="p:options" placeholder="по одному в строке">' + escapeHtml(optionsValue) + '</textarea></div>';
      }
      if (props.indexOf('primary') >= 0) {
        html += row('главная', '<input type="checkbox" data-prop="p:primary"' + (el.props.primary !== false ? ' checked' : '') + '>');
      }
      if (props.indexOf('limit') >= 0) html += row('штук', numberInput('p:limit', el.props.limit));
      if (props.indexOf('empty') >= 0) html += row('пусто', textInput('p:empty', el.props.empty, 'текст, когда ничего нет'));
    }

    html += '<div class="row" style="margin-top:8px"><label></label><button class="btn danger" id="delete-el">Удалить элемент</button></div>';

    html += '<div class="methods"><h3 style="padding:0 0 6px">Методы</h3>';
    methodsFor(el).forEach(function (method) {
      html +=
        '<div class="m"><span><b>' + method.title + '</b><br>' + escapeHtml(method.name) + '</span>' +
        '<button data-copy="' + escapeHtml(method.name) + '">копировать</button></div>';
    });
    html += '<div class="muted">Это то, что обвязывается в n8n. Событие несёт значения всех полей.</div></div>';

    var old = aliasesOf(el.id);
    if (old.length) {
      html += '<div class="muted">старые имена работают: <b>' + escapeHtml(old.join(', ')) + '</b></div>';
    }

    inspector.innerHTML = html;
  }

  function updateRectInputs(el) {
    ['x', 'y', 'w', 'h'].forEach(function (key) {
      var input = inspector.querySelector('[data-prop="' + key + '"]');
      if (input && document.activeElement !== input) input.value = el[key];
    });
  }

  // --- сохранение --------------------------------------------------------------

  function save() {
    if (!state.form) return Promise.resolve();
    saveBtn.disabled = true;
    return api('/api/v1/admin/forms/' + state.slug, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ form: state.form })
    })
      .then(function () {
        state.dirty = false;
        state.hasDraft = true;
        history.length = 0;
        syncDraft();
        syncOption();
        setStatus('сохранено в черновик · ' + new Date().toLocaleTimeString(), 'ok');
      })
      .catch(function (err) {
        setStatus('не сохранилось: ' + err.message, 'err');
      })
      .then(function () {
        saveBtn.disabled = false;
      });
  }

  function publish() {
    if (!state.form) return Promise.resolve();
    if (state.dirty) {
      setStatus('сначала сохраните черновик, потом публикуйте', 'err');
      return Promise.resolve();
    }
    publishBtn.disabled = true;
    return api('/api/v1/admin/forms/' + state.slug + '/publish', { method: 'POST' })
      .then(function () {
        state.hasDraft = false;
        syncDraft();
        syncOption();
        setStatus('опубликовано · ' + new Date().toLocaleTimeString(), 'ok');
      })
      .catch(function (err) {
        setStatus('не опубликовалось: ' + err.message, 'err');
      })
      .then(function () {
        publishBtn.disabled = false;
      });
  }

  // --- события интерфейса ------------------------------------------------------

  select.addEventListener('change', function () {
    if (state.dirty && !window.confirm('Есть несохранённые правки. Переключить страницу?')) {
      select.value = state.slug;
      return;
    }
    loadForm(select.value).catch(function (err) { setStatus(err.message, 'err'); });
  });

  saveBtn.addEventListener('click', save);
  publishBtn.addEventListener('click', publish);

  var modal = $('#modal');
  var newSlug = $('#new-slug');
  var newTitle = $('#new-title');

  $('#new-page').addEventListener('click', function () {
    newSlug.value = '';
    newTitle.value = '';
    modal.hidden = false;
    newSlug.focus();
  });

  $('#new-cancel').addEventListener('click', function () {
    modal.hidden = true;
  });

  modal.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') modal.hidden = true;
    if (event.key === 'Enter') $('#new-create').click();
  });

  $('#new-create').addEventListener('click', function () {
    var slug = newSlug.value.trim().toLowerCase();
    var title = newTitle.value.trim();
    if (!slug || !title) {
      setStatus('нужны slug и заголовок', 'err');
      return;
    }
    api('/api/v1/admin/forms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: slug, title: title })
    })
      .then(function () {
        modal.hidden = true;
        return loadForms();
      })
      .then(function () {
        select.value = slug;
        return loadForm(slug);
      })
      .then(function () {
        setStatus('страница «' + slug + '» создана · метод ' + slug + '.heading', 'ok');
      })
      .catch(function (err) {
        setStatus('не создалось: ' + err.message, 'err');
      });
  });

  palette.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-kind]');
    if (button) addElement(button.dataset.kind);
  });

  canvas.addEventListener('pointerdown', function (event) {
    if (event.target === canvas) {
      state.selected = null;
      renderSelection();
      renderInspector();
    }
  });

  inspector.addEventListener('click', function (event) {
    if (event.target.id === 'delete-el') {
      removeSelected();
      return;
    }
    var copy = event.target.closest('button[data-copy]');
    if (copy) {
      var text = copy.dataset.copy;
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      setStatus('скопировано: ' + text, 'ok');
    }
  });

  inspector.addEventListener('input', function (event) {
    var input = event.target;
    var prop = input.dataset.prop;
    var el = selected();
    if (!prop || !el || state.dragging) return;
    if (prop === 'id') return;

    if (!armSnapshot) {
      snapshot();
      armSnapshot = true;
    }

    var value;
    if (input.type === 'checkbox') value = input.checked;
    else if (input.type === 'number') value = Math.max(0, Number(input.value) || 0);
    else value = input.value;

    if (prop.indexOf('p:') === 0) {
      var key = prop.slice(2);
      if (key === 'options') {
        el.props.options = String(value).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      } else {
        el.props[key] = value;
      }
    } else {
      el[prop] = value;
    }
    if (prop === 'x' || prop === 'y' || prop === 'w' || prop === 'h') {
      var maxX = state.form.canvas.width - el.w;
      el.x = Math.min(el.x, Math.max(0, maxX));
    }
    renderCanvas();
    markDirty();
  });

  inspector.addEventListener('focusin', function (event) {
    if (event.target.dataset && event.target.dataset.prop) armSnapshot = false;
  });

  inspector.addEventListener('focusout', function () {
    armSnapshot = true;
  });

  inspector.addEventListener('change', function (event) {
    var input = event.target;
    if (input.dataset.prop !== 'id') return;
    var el = selected();
    if (!el) return;

    var next = String(input.value || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(next)) {
      setStatus('id: латиница, цифры и _, начинается с буквы', 'err');
      input.value = el.id;
      return;
    }
    if (state.form.elements.some(function (item) { return item !== el && item.id === next; })) {
      setStatus('id «' + next + '» уже занят', 'err');
      input.value = el.id;
      return;
    }
    if (next === el.id) return;

    snapshot();
    var previous = el.id;
    var aliases = state.form.aliases || (state.form.aliases = {});
    Object.keys(aliases).forEach(function (from) {
      if (aliases[from] === previous) aliases[from] = next;
    });
    // имя снова занято элементом — алиас на него больше не нужен
    if (aliases[next] !== undefined) delete aliases[next];
    aliases[previous] = next;
    el.id = next;
    state.selected = next;
    renderCanvas();
    renderInspector();
    markDirty();
    setStatus('переименовано в «' + next + '» · старое имя «' + previous + '» осталось работать');
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Delete' && state.selected && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      removeSelected();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      event.preventDefault();
      undo();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });

  window.addEventListener('beforeunload', function (event) {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  renderPalette();
  loadForms()
    .then(function () { setStatus('готово'); })
    .catch(function (err) { setStatus('не загрузилось: ' + err.message, 'err'); });
})();
