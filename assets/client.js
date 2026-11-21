(function () {
  'use strict';

  var root = document.querySelector('[data-page]');
  if (!root) return;
  var PAGE = root.getAttribute('data-page');

  var STATUS = {
    idle: 'Ожидание',
    queued: 'В очереди',
    running: 'Рисует…',
    done: 'Готово',
    failed: 'Ошибка'
  };

  // Канвас фиксированной ширины масштабируется под окно целиком.
  var canvas = document.querySelector('.canvas');
  var stage = document.querySelector('.stage');
  function fit() {
    if (!canvas || !stage) return;
    var avail = stage.clientWidth;
    var width = canvas.offsetWidth || 960;
    var scale = Math.min(1, avail / width);
    canvas.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    stage.style.height = Math.round(canvas.offsetHeight * scale) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();
  setTimeout(fit, 150);

  function toast(message, isError) {
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' err' : '');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 4000);
  }

  function elById(id) {
    return document.querySelector('.el[data-id="' + id + '"]');
  }

  function setStatus(node, value) {
    var v = value || { state: 'idle' };
    var badge = node.querySelector('.badge');
    if (!badge) return;
    badge.className = 'badge state-' + (v.state || 'idle');
    var txt = badge.querySelector('.txt');
    if (txt) txt.textContent = v.text || STATUS[v.state] || STATUS.idle;
  }

  function setImage(node, value) {
    var box = node.querySelector('.imgbox');
    if (!box) return;
    var img = box.querySelector('img');
    var ph = box.querySelector('.ph');
    if (value && value.imageId) {
      if (!img) {
        img = document.createElement('img');
        box.appendChild(img);
      }
      img.src = '/media/' + value.imageId;
      if (ph) ph.remove();
    } else if (img) {
      img.remove();
    }
  }

  function setGallery(node, items) {
    var gal = node.querySelector('.gal');
    if (!gal) return;
    var list = items || [];
    gal.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = gal.getAttribute('data-empty') || 'Пока пусто';
      gal.appendChild(empty);
      return;
    }
    list.forEach(function (item) {
      var link = document.createElement('a');
      link.className = 'card';
      link.href = '/media/' + item.imageId;
      link.target = '_blank';
      link.rel = 'noopener';
      if (item.note) link.title = item.note;
      var img = document.createElement('img');
      img.src = '/media/' + item.imageId;
      img.alt = item.note || '';
      link.appendChild(img);
      gal.appendChild(link);
    });
  }

  function apply(id, value) {
    var node = elById(id);
    if (!node) return;
    var kind = node.getAttribute('data-kind');
    if (kind === 'edit' || kind === 'memo') {
      var input = node.querySelector('input, textarea');
      if (input && input !== document.activeElement) input.value = value == null ? '' : value;
    } else if (kind === 'combo') {
      var select = node.querySelector('select');
      if (select) select.value = value == null ? '' : value;
    } else if (kind === 'check') {
      var box = node.querySelector('input[type="checkbox"]');
      if (box) box.checked = !!value;
    } else if (kind === 'status') {
      setStatus(node, value);
    } else if (kind === 'image') {
      setImage(node, value);
    } else if (kind === 'gallery') {
      setGallery(node, value);
    }
  }

  function post(path, body) {
    return fetch('/api/v1/forms/' + PAGE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  function readValue(node) {
    var kind = node.getAttribute('data-kind');
    if (kind === 'edit' || kind === 'memo') {
      var input = node.querySelector('input, textarea');
      return input ? input.value : '';
    }
    if (kind === 'combo') {
      var select = node.querySelector('select');
      return select ? select.value : '';
    }
    if (kind === 'check') {
      var box = node.querySelector('input[type="checkbox"]');
      return box ? box.checked : false;
    }
    return undefined;
  }

  // Снимок формы на момент нажатия: change мог ещё не дойти до сервера,
  // а в Delphi обработчик видит форму целиком — здесь так же.
  function collectValues() {
    var values = {};
    Array.prototype.forEach.call(document.querySelectorAll('.el[data-kind]'), function (node) {
      var value = readValue(node);
      if (value !== undefined) values[node.getAttribute('data-id')] = value;
    });
    return values;
  }

  Array.prototype.forEach.call(document.querySelectorAll('.el[data-event]'), function (node) {
    var id = node.getAttribute('data-id');
    var event = node.getAttribute('data-event');
    var kind = node.getAttribute('data-kind');

    if (kind === 'button') {
      var btn = node.querySelector('button');
      if (!btn) return;
      btn.addEventListener('click', function () {
        btn.disabled = true;
        post('/events/' + id, { values: collectValues() })
          .then(function (res) {
            if (!res.ok) toast('Портал ответил ' + res.status, true);
          })
          .catch(function () {
            toast('Портал недоступен', true);
          })
          .then(function () {
            setTimeout(function () {
              btn.disabled = false;
            }, 1200);
          });
      });
      return;
    }

    node.addEventListener('change', function () {
      var body = { value: readValue(node) };
      post('/events/' + id, body).catch(function () {
        toast('Портал недоступен', true);
      });
    });
  });

  if (window.EventSource) {
    var source = new EventSource('/api/v1/forms/' + PAGE + '/stream');
    source.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);
        apply(msg.id, msg.value);
      } catch (err) {
        /* битое сообщение не должно ронять страницу */
      }
    };
  }
})();
