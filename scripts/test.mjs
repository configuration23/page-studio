// Запуск тестов в одном процессе: `node --test` порождает дочерние процессы,
// а в песочнице это упирается в EPERM. node:test умеет работать и так.
import '../test/model.test.mjs';
import '../test/state.test.mjs';
import '../test/render.test.mjs';
