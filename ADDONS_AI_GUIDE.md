# PALACE: полная документация аддонов для другого ИИ

Сверено с исходным кодом 13 октября 2026 года, коммит `3afe41ffa4c5a9c212940b7becc6919d117ea37c` репозитория `Adasdas711/mp-locations`.

Репозиторий: https://github.com/Adasdas711/mp-locations. Сверка с работающим sandbox подтвердила **137 публичных методов** SDK: все они перечислены в этой документации и сопровождающих типах. Рабочий шаблон проверен в desktop и мобильном профиле Chromium: установка, панель, настройки, локусы, Undo, параллельные команды, запрет записи в View, горячая клавиша и восстановление данных после перезагрузки.

**Текущий SDK: `api.version === '1.7.0'`. Формат пакета: `manifest.apiVersion === 1`.** Это разные версии. `1.7.0` нельзя записывать вместо числа `1` в `apiVersion`.

Этот файл самодостаточен: его можно целиком передать другому ИИ. Старые `ADDONS.md` и `API_GUIDE.md` описывают развитие API по версиям и местами содержат прежние названия меню. При расхождениях используйте данную сверенную справку и текущий код.

## 1. Инструкция для ИИ, который будет создавать расширение

Создавай локальное браузерное расширение **PALACE**, а не расширение VSCode. Результат — ZIP с расширением `.palace-addon`, в корне которого находятся `manifest.json` и основной JavaScript-файл. Используй только перечисленные ниже методы SDK. Объект `api` передаётся в `exports.activate(api)`.

Не придумывай `vscode.*`, `api.commands.execute`, `api.workspace`, `api.files`, `api.history`, `api.onCameraChanged`, `api.onThemeChanged`, `api.ui.registerSettingsPage`, `api.ui.addButton` или доступ к Three.js: таких интерфейсов у загружаемого аддона нет. Для кнопок используй декларации manifest, для настроек — `contributes.settings`, для истории — штатный системный модуль приложения.

Основные правила:

1. CommonJS: `exports.activate = ...`, `require('./utils')`. Никаких ESM `import`, Node.js `fs`, `process`, `Buffer` или внешних npm-зависимостей в исполняемом пакете. TypeScript/библиотеки можно заранее скомпилировать и включить как автономный браузерный JS.
2. Все обращения к редактору асинхронные: `await` + `try/catch`. Синхронны `commands.register`, `assets.read`, подписки и их `dispose()`.
3. Объяви команды, панели и кнопки в manifest. Все их ID начинаются с ID аддона и точки. Зарегистрируй обработчики команд в `activate`.
4. Запрашивай только реально нужные разрешения. Их наличие не отменяет режим просмотра, повторение и проверки параметров.
5. Не меняй возвращённые копии объектов, ожидая изменения проекта: вызывай метод записи.
6. Не считай индексы этажей/локусов постоянными. После перестановки, удаления или открытия проекта перечитывай данные. `floorId` и индекс этажа — разные сущности.
7. Имена кнопок и прочий интерфейс нового аддона делай на английском, как интерфейс приложения. Пользовательские названия и заметки сохраняй без перевода.
8. DOM доступен только внутри собственного iframe аддона. Пользовательский текст выводи через `textContent` или экранирование HTML.
9. Не запускай безусловную запись проекта из `onProjectChanged`: получится цикл уведомлений.
10. Не рассчитывай на сетевой запрос, прямое скачивание из iframe, доступ к внутренним глобальным переменным редактора или установку зависимого аддона.

## 2. Что такое аддон и где он работает

PALACE — браузерный редактор дворцов памяти: планы этажей, локусы/маршруты, панорамы и камеры с переходами, 3D-план и повторение. API аддонов — локальные JS-интерфейсы, а не REST-сервер. Для использования API не нужны URL сервера, токен или аккаунт.

Вызов из аддона проходит по цепочке:

```text
Код в iframe → SDK api.* → postMessage → проверка хоста → редактор → результат/ошибка
```

Хост сверяет источник сообщения и отдельный канал iframe, разрешения, аргументы и ограничения текущего режима. Прямого доступа к `window.parent.document`, внутреннему `state`, `PalaceAPI` или `localViewer` у загружаемого расширения нет. `window.PalaceAPI` в исходниках приложения — адаптер хоста, а не SDK аддона.

Изменения содержимого дворца участвуют в штатной истории Undo/Redo, автосохранениях и экспорте; системная Change history записывает версии, если включена. Видимость инструментов, оформление и данные самого аддона — отдельные браузерные предпочтения, а не содержимое дворца. Несколько API-вызовов не образуют общую атомарную транзакцию.

## 3. Установка и управление

Пользователь открывает шестерёнку **Settings → Community plugins → Install plugin**. Встроенный блок загрузки принимает ZIP или `.palace-addon`, включая drag-and-drop. После проверки показываются имя, версия и разрешения; запуск начинается после подтверждения установки.

Установленные пакеты сохраняются в IndexedDB текущего браузера/сайта. После перезагрузки включённые аддоны снова активируются. Копии между браузерами и устройствами не синхронизируются, в экспорт дворца они не входят. Очистка данных сайта удаляет установленные пакеты и их локальные данные.

Меню `⋯` карточки аддона содержит **Settings & log**, **Restart**, **Update from file**, **Remove**. Переключатель включает/выключает отдельный аддон. **Modular mode** включает/выключает все community plugins, сохраняя индивидуальные предпочтения. Системные аддоны от этого переключателя не зависят.

Пакет с тем же `id` обновляет установленный. Поддерживаются подтверждаемые обновление, переустановка и понижение версии. Совместимые объявленные настройки, `storage` и выключенное состояние сохраняются; новые разрешения показываются в предварительном просмотре. Удаление удаляет запись пакета вместе с его настройками и `storage`.

`Ctrl/⌘+Shift+P` открывает менеджер community plugins. Системная Command Palette по умолчанию открывается `Ctrl/⌘+P`, если включена и сочетание не переназначено. Активные зарегистрированные команды аддона доступны в менеджере и палитре, а также через объявленные кнопки/горячие клавиши.

## 4. Структура пакета и сборка

```text
my-addon/
  manifest.json
  main.js
  utils.js          # необязательно
  panel.html        # необязательно
  icon.svg          # необязательно
  images/
    panorama.jpg   # необязательно
```

ZIP должен содержать `manifest.json` непосредственно в корне, не внутри папки `my-addon/`.

Из корня репозитория:

```sh
node scripts/package-addon.cjs /absolute/path/my-addon /absolute/path/my-addon.palace-addon
```

Этот скрипт собирает ZIP с DEFLATE, отвергает символические ссылки, но не заменяет проверку manifest и установку в приложении. Сборка самого приложения для установки внешнего аддона не нужна.

Ограничения пакета:

| Что | Ограничение |
| --- | --- |
| Размер выбранного ZIP | До `8 * 1024 * 1024` байт |
| Суммарный распакованный размер | До `8 * 1024 * 1024` байт |
| Один распакованный файл | До `8 * 1024 * 1024` байт |
| Количество файлов, без директорий | Не более 100 |
| Путь файла | Менее 200 символов; без абсолютного пути, `\\`, пустых сегментов, `.` и `..` |
| Текстовые файлы | Корректный UTF-8, декодирование строгое |
| Бинарные изображения | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`; преобразуются в data URL |
| SVG | UTF-8 текст; для значка используется как data URL |

Произвольный бинарный файл, например `.wasm`, `.woff` или `.bin`, не загружается как бинарный ресурс пакета: все файлы, кроме перечисленных растровых изображений, декодируются как UTF-8. При необходимости включи base64/data URL в текстовый ресурс и используй только возможности браузерного sandbox.

`require('./utils')` добавляет `.js` и загружает файл относительно текущего модуля. `require('./sub/module.js')` допустим. Поиск `node_modules`, `../`, абсолютные импорты, разрешение `folder/index.js` и JSON через `require` отсутствуют. JSON читай через `JSON.parse(api.assets.read('file.json'))`. Модули кэшируются в рамках текущего iframe. Обёртка модуля использует параметры `module`, `exports`, `require`, `palace`: не объявляй одноимённые `let/const` в верхнем уровне файла. Для сохранения SDK используй, например, `let addonApi;` и присваивание в `activate(api)`.

## 5. Manifest: полная схема используемых полей

```json
{
  "id": "my.addon",
  "name": "My addon",
  "description": "What this addon does.",
  "version": "1.0.0",
  "apiVersion": 1,
  "engines": {"palace": ">=1.4.0 <2.0.0"},
  "main": "main.js",
  "permissions": ["project.read", "markers.write", "ui.contribute", "keybindings.write"],
  "contributes": {
    "commands": [
      {"id": "my.addon.open", "title": "Open addon panel"},
      {"id": "my.addon.center", "title": "Add locus at center"}
    ],
    "panels": [
      {"id": "my.addon.panel", "title": "My addon"}
    ],
    "activityBar": [
      {"id": "my.addon.activity", "title": "My addon", "icon": "icon.svg", "command": "my.addon.open"}
    ],
    "toolbars": [
      {"id": "my.addon.center-tool", "title": "Add locus", "location": "plan", "icon": "pin", "command": "my.addon.center"}
    ],
    "settings": [
      {"key": "note", "title": "Default note", "description": "Text for a new locus.", "type": "string", "default": "Created by addon"},
      {"key": "showCount", "title": "Show locus count", "type": "boolean", "default": true},
      {"key": "limit", "title": "Display limit", "type": "number", "min": 1, "max": 100, "default": 10}
    ]
  }
}
```

| Поле | Требование |
| --- | --- |
| `id` | 3–80 символов, regex `^[a-z][a-z0-9.-]{2,79}$`; стабильный ID для обновлений |
| `name` | Непустая строка до 120 символов |
| `description` | Необязательное текстовое описание для карточки |
| `version` | Строка из трёх числовых частей `major.minor.patch`, без `v`, prerelease и build suffix |
| `apiVersion` | Число `1` |
| `main` | Безопасный путь существующего текстового `.js` внутри ZIP |
| `permissions` | Обязательный массив разрешений из следующего раздела; может быть пустым |
| `engines.palace` | Необязательное требование к версии SDK |
| `contributes` | Необязательный объект деклараций |

ID команд, панелей и кнопок должны начинаться с `manifest.id + '.'` и быть уникальными **между всеми четырьмя группами**. Суммарно не более 60 элементов в `commands + panels + activityBar + toolbars`. У каждого обязательны `id` и непустой `title` до 120 символов. У кнопки `command` ссылается на объявленную команду; у toolbar обязателен допустимый `location`. Кнопки требуют `ui.contribute` уже при проверке manifest.

`engines.palace` поддерживает полные версии: `1.4.0`, `^1.4.0`, `~1.4.0`, `>=1.4.0`, `<=1.4.0`, `>1.3.0`, `<2.0.0`, `=1.4.0`, либо условия через пробел, которые должны выполняться одновременно. `*` и отсутствие поля разрешают текущую совместимость API v1. Не поддерживаются `||`, версии `1`, `1.4`, `1.x`, prerelease и диапазоны через дефис.

VSCode-поля `activationEvents`, `extensionDependencies`, `configuration` и подобные не предоставляют соответствующих возможностей PALACE. Включённый аддон активируется при загрузке/установке; собственные параметры объявляй в `contributes.settings`.

## 6. Разрешения: фактическая проверка хоста

| Разрешение | Защищённые действия |
| --- | --- |
| `project.read` | `project.read`; доставка `onProjectChanged` |
| `metadata.write` | `project.updateMetadata` |
| `markers.write` | Все методы `markers` |
| `plan.read` | `plan.read` |
| `plan.write` | `plan.add/remove/rename/move/merge/split/transform`, `plan.walls.*` |
| `tour.read` | `tour.read` |
| `tour.write` | `tour.add/remove/loadPanorama/update/connect/setStart` |
| `view.control` | `plan.select`, `tour.select/pose`, `view.read/set` |
| `ui.control` | `ui.execute/theme/scale/setToolVisible/iconTheme` |
| `ui.contribute` | Manifest-кнопки `activityBar/toolbars`, `ui.overlay`, `ui.registerAppearance/removeAppearance` |
| `archive.read` | `archive.list/read/export/download/meta.read` |
| `archive.write` | `archive.write/remove/meta.write` |
| `keybindings.write` | `keybindings.register/unregister` |

Отдельное разрешение **не требуется** для `commands.register`, `ui.showMessage`, `theme.read`, `storage.*`, `assets.read`, `settings.*`, `onSettingsChanged`, `ui.tools/themes/commands/iconThemes`, `keybindings.list`. `ui.showPanel` проверяет декларацию панели в manifest, но отдельного permission у него нет.

`archive.write` не включает `archive.read`; `plan.write` не включает `plan.read`; `tour.write` не включает `tour.read`. Для операции «прочитать, изменить, записать» объяви оба права. Подписку `onProjectChanged` можно создать без `project.read`, но хост не доставит ей события.

Все прямые методы записи содержимого дворца требуют режима `edit` и отсутствия активного повторения. Методы управления просмотром также имеют ограничения повторения. Оформление, storage и настройки аддона можно менять независимо от режима редактирования. Ошибка прав обычно возвращается как `Permission denied: ...`; ошибка режима — `Switch to edit mode.` или `Stop reviewing first.`

## 7. Жизненный цикл, ошибки и подписки

```js
let disposables = [];

exports.activate = async api => {
  disposables.push(api.commands.register('my.addon.open', async () => {
    await api.ui.showPanel('my.addon.panel', '<h2>My addon</h2>');
  }));

  disposables.push(api.onProjectChanged(project => {
    // Обнови собственную панель. Не записывай проект без условия.
  }));
};

exports.deactivate = () => {
  for (const disposable of disposables) disposable.dispose();
  disposables = [];
};
```

`activate(api)` обязателен; может быть синхронным или возвращать Promise. `deactivate()` необязателен; `api` аргументом в него не передаётся. Сохрани нужные ссылки в области модуля. Он вызывается при выгрузке iframe, без ожидания асинхронной очистки: важные записи выполняй заранее, а не в `deactivate`.

| Операция | Таймаут |
| --- | --- |
| Один SDK RPC к хосту | 10 секунд, ошибка `API timeout` |
| Активация | 12 секунд |
| Команда | 15 секунд |

Таймаут не является API отмены уже начавшейся операции. Разбивай длительные задачи и не держи `activate` занятым ожиданием пользователя.

Исключение обработчика команды передаётся менеджеру как ошибка команды. Необработанные исключения/Promise rejection в iframe и ошибки активации переводят хост в состояние ошибки: команды и API перестают быть доступны, кнопки/оформление/горячие клавиши снимаются. Пользователь может выполнить **Restart**. Не рассчитывай, что состояние ошибки немедленно уничтожит iframe и остановит каждый таймер.

Колбэки подписок должны сами обрабатывать асинхронные ошибки:

```js
api.onProjectChanged(project => {
  refreshPanel(project).catch(error => {
    const node = document.querySelector('#addonStatus');
    if (node) node.textContent = error.message;
  });
});
```

`onProjectChanged(handler)` возвращает `{dispose()}`. События поступают с debounce около 100 мс после изменений/перерисовок, только готовому хосту с `project.read`. Это полная компактная копия проекта, не журнал операций; может приходить и после изменений просмотра. Первую копию получи самостоятельно через `await api.project.read()`.

`onSettingsChanged(handler)` также возвращает `{dispose()}` и передаёт полные актуальные объявленные настройки. Начальное значение читай через `settings.read()`. Не выполняй безусловный `settings.update` из этого обработчика.

## 8. Модель данных и общие соглашения

```ts
type LevelIndex = number;          // целый индекс с нуля
type MarkerIndex = number;         // целый индекс с нуля внутри этажа
type CameraId = string;            // ключ объекта api.tour.read()
type FloorId = string | number | null;
type Point = {x: number; y: number};
type Layout = 'plan' | 'tour' | 'split' | 'split-rev';
type PlanView = '2d' | '3d';
```

Координаты плана — пиксели исходного изображения, начало в левом верхнем углу; масштаб экрана не меняет их. Для локуса, камеры или стены числовые координаты должны быть конечными и попадать в `0 <= x <= floor.w`, `0 <= y <= floor.h`.

`src` для загрузки плана/панорамы — строка `data:image/png|jpeg|webp|avif;base64,...`. У SDK нет загрузки по внешнему URL. Проверяется длина всей строки до `16 * 1024 * 1024` символов, включая префикс; это не лимит 16 MiB декодированной картинки. Изображение должно успешно декодироваться браузером.

```js
function fileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Unable to read file'));
    reader.readAsDataURL(file);
  });
}
```

Не передавай `Blob`, DOM-элемент или функцию как поле API-запроса. Используй простые объекты, строки, массивы и числа; данные пересылаются через `postMessage`.

## 9. Полный справочник SDK

В таблицах результаты указаны **после `await`**. Исключения синхронности отмечены отдельно.

### 9.1 Команды

| Метод | Результат и особенности |
| --- | --- |
| `api.commands.register(id, handler)` | Синхронно `{dispose()}`. Команда должна быть объявлена в manifest. `handler` может возвращать значение/Promise; собственные вызовы не должны предполагать, что пользовательские аргументы команды существуют. |

Повторная регистрация того же ID заменяет обработчик в текущем iframe. `dispose()` снимает его. Общего публичного `commands.execute` нет: для собственных действий вызывай общую функцию своего модуля. Для штатных действий см. `ui.commands/execute`.

### 9.2 Проект и метаданные

| Метод | Результат |
| --- | --- |
| `api.project.read()` | `ProjectSummary`, компактная копия без байтов изображений/панорам |
| `api.project.updateMetadata(patch)` | Обновлённый `ProjectSummary` |

```js
// Пример формы ProjectSummary; значения зависят от открытого дворца.
{
  name: 'My palace', purpose: '', source: '', explain: '', notes: '',
  active: 0, mode: 'edit',
  levels: [{index: 0, name: 'Floor 1', w: 1000, h: 800, floorId: 1,
            markers: [{x: 100, y: 80, note: 'Remember', localPano: 'camera-a'}]}],
  panoramas: [{id: 'camera-a', room: 'Entrance', floorId: 1,
               planPx: {x: 100, y: 80}, destinations: [{panoId: 'camera-b'}]}]
}
```

`project.read().panoramas` — **массив**; `tour.read()` — **объект по ID**. Некоторые поля импортированных объектов могут отсутствовать/null; не подменяй отсутствие данных предположением.

`updateMetadata` принимает только `name`, `purpose`, `source`, `explain`, `notes`. Каждое переданное значение — строка до 50 000 символов. Это метаданные редактора, не `meta.json` архива; для последнего используется `archive.meta`.

### 9.3 Локусы

| Метод | Результат/аргументы |
| --- | --- |
| `api.markers.add({level,x,y,note?})` | `{level,index}` нового локуса |
| `api.markers.remove({level,index})` | `true` |
| `api.markers.update({level,index,patch})` | `true`; поля patch: `x`, `y`, `note`, `localPano` |

`note` — строка до 50 000 символов. Добавление ограничено 100 локусами на этаж. `localPano` связывает локус с существующей камерой; `null` снимает привязку. При изменении части координат проверяется итоговая точка с учётом остальных полей. Дополнительные поля patch отклоняются. После удаления/перестановки перечитай индексы.

### 9.4 Планы и этажи

| Метод | Результат/поведение |
| --- | --- |
| `api.plan.read(level?)` | Полная копия этажа, по умолчанию активного; содержит `src`, `w`, `h`, `markers`, `walls` и другие данные редактора |
| `api.plan.add({src,name?,floorId?})` | Индекс добавленного этажа; он становится активным |
| `api.plan.remove(level)` | `true`; удаляет этаж, корректирует активный индекс |
| `api.plan.rename({level,name})` | `true` |
| `api.plan.select(level)` | `true`; требует `view.control`, недоступен во время повторения |
| `api.plan.move({from,to})` | `true`; переставляет этаж |
| `api.plan.merge({from,to})` | `true` после запроса штатного объединения; `from !== to`; открывает штатный режим размещения частей |
| `api.plan.split(level)` | `true` после вызова разделения; содержательный результат есть у плана с несколькими частями |
| `api.plan.transform({rotation})` | `true`; задаёт угол отображения плана в градусах, не переписывает пиксели исходной картинки |
| `api.plan.walls.add({level,x1,y1,x2,y2})` | Индекс добавленной стены |
| `api.plan.walls.remove({level,index})` | `true` |

При `plan.add` необязательный `name` обрезается до 100 символов; по умолчанию `New floor`. `floorId` — строка/число, при отсутствии используется `null`. Загрузка, завершившаяся после смены проекта, отклоняется с `Project changed during loading.`

Публичного метода вставки произвольного объекта этажа или замены `src` существующего этажа нет. `plan.remove` не является обещанием удаления всех камер этого `floorId`: камеры удаляй явно через `tour.remove`, если это нужно функции аддона.

`merge/split` и штатные команды могут возвращать `true`, даже если внутренний редактор пропустил действие или отменил его из-за смены проекта. Для проверки результата перечитай этажи; не трактуй `true` как подтверждение завершённого пользователем размещения частей. У SDK нет `finishArrange/cancelArrange` или параметров размещения частей.

### 9.5 Вид и панорамы

| Метод | Результат/поведение |
| --- | --- |
| `api.view.read()` | `{layout,planView,zoom,rotation,activeCamera,yaw,pitch,fov}` |
| `api.view.set({layout?,planView?,zoom?})` | Фактический `ViewState` после применения |
| `api.tour.read()` | Объект `{[cameraId]: Camera}` с локальными данными панорам |
| `api.tour.select(id)` | `true`; открывает просмотр панорамы указанной камеры |
| `api.tour.pose({yaw?,pitch?,fov?})` | Фактический `ViewState` |

Все методы `view` требуют `view.control`, включая чтение. `view.set`, `tour.select`, `tour.pose` недоступны во время повторения. На маленьком экране редактор может скорректировать layout. Для 3D-плана нужны этажи и работающий WebGL; при неудаче редактор может показать уведомление и остаться в `2d` — смотри возвращённый `planView`.

`view.set.zoom` принимает положительное конечное число до 20, но механизм 2D-плана применяет собственный динамический минимум и максимум 4. Это не API управления орбитой/масштабом 3D-модели. `rotation` читается здесь, задаётся через `plan.transform`.

`tour.pose`: углы в градусах, `yaw` нормализуется в `[0,360)`, `pitch` ограничивается `[-85,85]`, `fov` — `[30,150]`. Требуется уже созданный renderer панорамы. `await tour.select(id)` подтверждает запрос выбора, но не гарантирует завершение асинхронной загрузки изображения/WebGL; немедленный `pose` может вернуть `Open the 3D view first.` В SDK 1.5 используй `tour.waitForPanoramaReady(id)` и `tour.onPanoramaReady`; полный контракт — в [SCENE_SDK.md](SCENE_SDK.md).

### 9.6 Создание и редактирование камер

| Метод | Результат/поведение |
| --- | --- |
| `api.tour.add({id?,level?,room?,planPx?,src?})` | `{id}` новой камеры |
| `api.tour.loadPanorama({id,src})` | `{id}`; заменяет панораму камеры |
| `api.tour.remove(id)` | `true`; удаляет камеру, её связи, назначение начальной и привязки локусов |
| `api.tour.update({id,patch})` | `true`; patch: `room`, `hidden`, `headingDeg`, `navYawOffsetDeg`, `planPx` |
| `api.tour.connect({from,to,add})` | `true`, если изменился двусторонний переход, иначе `false` |
| `api.tour.setStart(idOrNull)` | `true`; назначает начальную камеру или сбрасывает её |

`level` — индекс, по умолчанию активный. Без `id` создаётся UUID. Явный ID — 1–100 символов `a-zA-Z0-9._-`, уникальный; `__proto__`, `constructor`, `prototype` запрещены. `room` — строка до 1000 символов. Для этажа без `floorId` идентификатор назначается автоматически.

Без `src` создаётся камера `mode: 'none'`. Без позиции `planPx` камера не отображается на плане, но остаётся в списке камер. `tour.loadPanorama` использует локальную эквидистантную картинку (`mode: 'equirect'`); метод не загружает cube-map по списку URL. У импортированных камер могут быть дополнительные поля и другие режимы: сохраняй их, если меняешь только разрешённые поля через `update`.

`planPx: {x,y}` задаёт позицию на этаже камеры; `planPx: null` убирает позицию. `hidden` — boolean; углы — конечные числа. `connect` добавляет/удаляет оба направления; не создаёт дубликаты. Возвращает `false`, если камеры отсутствуют, одинаковы или нужное состояние уже есть. Начальная ориентация `startYaw` через `setStart` не задаётся: этот метод принимает только ID/null.

```js
const {id} = await api.tour.add({
  level: 0, room: 'Entrance', planPx: {x: 100, y: 80},
  src: api.assets.read('images/panorama.jpg')
});
await api.tour.setStart(id);
// При наличии другой камеры:
await api.tour.connect({from: id, to: 'other-camera-id', add: true});
```

### 9.7 Интерфейс, кнопки и безопасные слои

| Метод | Результат/поведение |
| --- | --- |
| `api.ui.showMessage(text)` | `true`; сообщение в строке состояния, до 2000 символов |
| `api.ui.showPanel(id,html)` | `undefined`; открывает объявленную панель и заменяет её HTML в собственном iframe |
| `api.ui.commands()` | `[{id,title}]` из текущего реестра штатных горячих клавиш/команд |
| `api.ui.execute(id)` | `true` после вызова команды; не ожидает весь её асинхронный внутренний процесс |
| `api.ui.tools()` | `[{id,title,owner,visible}]` существующих инструментов |
| `api.ui.setToolVisible(id,visible)` | `true`; сохраняет видимость в этом браузере |
| `api.ui.themes()` | `[{id,title}]` встроенных и зарегистрированных тем |
| `api.ui.theme(id)` | `ThemeState` после переключения |
| `api.ui.scale(size)` | Переданное `0`, `1` или `2`: Small, Medium, Large |
| `api.ui.overlay(input)` | `true`; создание/замена/удаление безопасного графического слоя |

Список `ui.commands()` динамический: он включает зарегистрированные shortcut-команды активных аддонов, но не обязан содержать каждую manifest-команду или каждый дополнительный пункт Command Palette. Выбирай ID из возвращённого списка. Например, не предполагается публичный `edit.undo` только потому, что Undo есть в палитре. Во время повторения `ui.execute` разрешает только `review.start`, `file.save`, `hotkeys.open`.

`ui.tools().visible` — пользовательская настройка; это не гарантия, что элемент сейчас виден на экране. Режим просмотра, закрытая панель или отсутствующий план могут дополнительно скрыть инструмент. Скрытие инструмента не отнимает права и не снимает команду/горячую клавишу.

ID инструментов:

```text
system.<id элемента>               # штатный элемент, выбирай из ui.tools()
addon.<contribution.id>            # кнопка activityBar/toolbar
addon.command.<command.id>         # кнопка команды в менеджере
addon.layer.<overlay.id>           # графический слой
```

`activityBar` добавляет собственный значок слева. `toolbars.location` принимает `plan`, `tour`, `header`, `status`. Настройки видимости находятся в **Settings → Interface**; новые кнопки не регистрируются произвольным DOM-вызовом.

Для `icon` у кнопки используй имя встроенного символа **без** `i-` (`pin`, `camera`, `gear`, `cube`, `floorplan`, `braces`, `search`, `save`, `folder`, `flag`, `camera-edit` и др.) или путь SVG/PNG/JPEG/WebP/AVIF в пакете. Неизвестное имя заменяется на `braces`. Полный список текущих символов приведён в приложении этого файла.

Слой:

```js
await api.ui.overlay({
  id: 'my.addon.highlight', title: 'Addon highlight', location: 'plan',
  shapes: [
    {type: 'circle', cx: 120, cy: 80, r: 20, stroke: '#4da3ff', fill: 'none', 'stroke-width': 2},
    {type: 'text', x: 120, y: 50, text: 'Selected', fill: '#4da3ff', 'font-size': 14}
  ]
});
await api.ui.overlay({id: 'my.addon.highlight', location: 'plan', remove: true});
```

`location`: `plan` или `tour`; ID начинается с ID аддона и точки. До 500 фигур `circle`, `rect`, `line`, `text`. Разрешены только `x,y,x1,y1,x2,y2,width,height,r,cx,cy,stroke,fill,stroke-width,opacity,font-size,text`. Числа конечные, абсолютное значение до 100 000. `text` — только у `text`, до 2000 символов. `stroke/fill`: hex, `none` или буквенное имя цвета; не URL/CSS-выражение.

У плана координаты слоя соответствуют изображению активного этажа; у панорамы область 1000×1000. Это SVG над экраном с `pointer-events:none`, не 3D-меш и не интерактивный слой. Плановый слой связан с индексом активного этажа на момент создания: при смене/перестановке этажей или проекта пересчитай его через своё состояние и события. Слои не экспортируются как содержимое дворца; отключение аддона удаляет их.

### 9.8 Оформление: темы и системные значки

| Метод | Результат |
| --- | --- |
| `api.ui.registerAppearance({themes?,iconThemes?})` | `{themes: string[], iconThemes: string[]}` зарегистрированных ID |
| `api.ui.removeAppearance()` | `true` |
| `api.ui.iconThemes()` | `[{id,title,active}]` |
| `api.ui.iconTheme(id)` | Выбранный ID; `system.default` восстанавливает системные значки |
| `api.theme.read()` | `ThemeState`, без отдельного разрешения |

```js
await api.ui.registerAppearance({
  themes: [{
    id: 'my.addon.ocean', title: 'Ocean', base: 'darcula', mode: 'dark',
    colors: {accent: '#168a9c', focus: '#168a9c', btn: '#168a9c'},
    canvas: {bg: '#101d2b', walls: '#168a9c'}
  }],
  iconThemes: [{
    id: 'my.addon.icons', title: 'My icons',
    icons: {'i-folder': [{d: 'M2 3H6L8 5H14V13H2Z', filled: false}]}
  }]
});
await api.ui.theme('my.addon.ocean');
await api.ui.iconTheme('my.addon.icons');
```

За один каталог аддона — до 30 тем и наборов значков суммарно. ID начинается с ID аддона и точки, regex `^[-a-z0-9.]{3,120}$`; title — непустая строка до 100 символов. ID системного или чужого оформления заменить нельзя. Вся входная коллекция проверяется до регистрации; повторный вызов заменяет **весь каталог этого аддона**, а не добавляет один элемент.

Тема наследует только встроенную `base`, не тему другого аддона. `mode` — `dark`/`light`, при отсутствии `dark`. Цвета — строго `#RRGGBB`.

Разрешённые ключи `colors`:

```text
chrome editor widget dialog border widgetBorder fg fgStrong fgDim fgMute
input inputBorder btn btnHover btnFg btn2 btn2Hover accent focus sel
status statusFg statusItem statusItemFg activityFg activityInactive hover
```

В `canvas` разрешены только `bg` и `walls`. Другие свойства наследуются от базовой темы; шрифты/разметка/произвольный CSS через каталог не задаются. Пользовательские предпочтения акцента/шрифта приложения могут дополнительно переопределить отображение темы.

Набор значков содержит до 100 существующих `i-*` символов; у каждого 1–12 объектов пути `{d,filled?}`. `d` — непустой SVG path до 4000 символов, только команды пути/числа; `filled` — boolean, по умолчанию false. `<svg>` разметка, новые ID символов, URL, скрипты и произвольные атрибуты не принимаются. Учитывай viewBox исходного системного символа.

Каталог существует пока работает его аддон. При выключении/удалении/ошибке он снимается; редактор пытается восстановить прежнюю доступную тему и значки. Для восстановления после запуска сохрани свой каталог через `storage`, затем зарегистрируй его в `activate`. Выбранную пользователем тему/иконки хранит редактор.

`ThemeState`:

```ts
{
  name: string; background: string; foreground: string; accent: string;
  colorScheme: string;
  ui: Record<string, string>; // значения CSS-переменных ниже
}
```

В `ui` входят `--text`, `--muted`, `--line`, `--panel`, `--bg`, `--blue`, `--vscode-input-bg`, `--vscode-button-bg`, `--vscode-button-fg`, `--t-hover`, `--t-font-ui`. Пустое значение возможно; используй CSS fallback.

### 9.9 Исходный архив и meta.json

| Метод | Результат |
| --- | --- |
| `api.archive.list()` | `[{path}]` файлов исходного открытого ZIP с учётом правок |
| `api.archive.read({path,encoding?})` | `{path,encoding,data}`; `text` по умолчанию, либо `base64` |
| `api.archive.write({path,encoding,data})` | `true`; для `meta.json` — результат его записи, который может быть `false` |
| `api.archive.remove(path)` | `true`; для `meta.json` может быть `false`, если изменение не требуется |
| `api.archive.meta.read()` | JSON-объект или `null` при отсутствии файла; невалидный JSON отклоняет запрос |
| `api.archive.meta.write(objectOrNull)` | Boolean: изменилось ли содержимое; `null` удаляет `meta.json` |
| `api.archive.export()` | `{name,encoding:'base64',data}` ZIP с правками |
| `api.archive.download()` | `{name}`; хост скачивает исходную копию ZIP с правками, имя получает суффикс `-edited` |

Нужен ранее открытый `.mplace`/`.mpalace`/`.3dview` архив. Для дворца, созданного только из картинок, исходного ZIP может не быть. Ошибка: `Open an archive first.`

`archive` редактирует **копию исходных файлов**, не весь текущий редактор. Правка `palace.json`, `links.json`, панорамы или изображения через `archive.write` не перестраивает открытый проект. Для применения служебных правок скачай/экспортируй копию и открой её заново.

Штатный экспорт `.mpalace/.mplace` заново создаёт файлы из текущего состояния редактора. Он добавляет новые дополнительные файлы из правок и актуальный `meta.json`, но сформированные файлы проекта имеют приоритет; удаления/замены старых служебных файлов исходного ZIP не являются способом изменить этот штатный экспорт. Для точной исходной копии с заменами/удалениями используй `archive.export/download`.

| Ограничение | Значение |
| --- | --- |
| Один читаемый/записываемый файл | До 16 MiB декодированных данных |
| Сумма содержимого правок | До 32 MiB; для base64 используется оценка длины × 0,75 |
| Число уникальных путей правок, включая удаления | До 200 |
| `meta.json` | JSON-объект или null, до 1 MiB UTF-8 после форматирования |
| Путь | 1–512 символов, без абсолютного пути, `\\`, управляющих символов, пустых сегментов, `.` и `..` |

Повторная запись одного пути заменяет его правку. Для бинарных данных используй `base64`; `text` читается строгим UTF-8. `meta.json` нельзя заменить массивом, числом или строкой. Запись `meta.json` через `archive.write` тоже проходит специальную проверку объекта.

```js
const meta = await api.archive.meta.read() || {};
await api.archive.meta.write({...meta, myAddon: {version: 1}});
await api.archive.write({path: 'addons/my-addon/info.txt', encoding: 'text', data: 'Added by my addon'});
const files = await api.archive.list();
const exported = await api.archive.export();
// exported.data — base64 всего ZIP, не отдельного файла.
```

SDK не имеет произвольного `downloadBlob` для файлов аддона. Для исходного архива предусмотрен `archive.download`; собственный JSON можно вывести пользователю в textarea/панели, а импортировать через file input.

### 9.10 Горячие клавиши

| Метод | Результат |
| --- | --- |
| `api.keybindings.register({id,command,key})` | `{id,key}` с фактической привязкой |
| `api.keybindings.unregister(id)` | Boolean: существовала ли собственная привязка |
| `api.keybindings.list()` | `[{id,title,key,owner}]` текущего реестра; `owner` — ID аддона или `system` |

ID привязки начинается с ID аддона и точки, regex `^[-a-z0-9.]{3,120}$`. Команда должна быть объявлена **и уже зарегистрирована**. До 30 привязок на аддон. Повторная регистрация своего ID заменяет привязку. Нельзя снять чужую/системную привязку.

Формат клавиши: необязательные модификаторы строго в порядке `Ctrl+Alt+Shift+`, затем один из:

```text
KeyA..KeyZ, Digit0..Digit9, F1..F24,
ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
Space, Enter, Home, End, PageUp, PageDown
```

`Ctrl` в приложении соответствует также ⌘ на macOS. `Ctrl+Shift+KeyP` и `Ctrl+Alt+KeyT` зарезервированы; конфликты с текущими командами/фиксированными действиями отвергаются. Пользовательское переназначение Hotkeys может заменить переданный `key` или сделать его пустым: используй результат регистрации/список.

```js
api.commands.register('my.addon.open', openPanel);
try {
  await api.keybindings.register({
    id: 'my.addon.open-key', command: 'my.addon.open', key: 'Ctrl+Alt+Shift+KeyU'
  });
} catch (error) {
  await api.ui.showMessage('Shortcut unavailable: ' + error.message);
  // Кнопка/команда остаются доступны; не ломай активацию из-за конфликта.
}
```

Регистрируй сочетания в `activate` для восстановления после перезагрузки. Выключение, удаление и ошибка хоста снимают их. Они работают в основном окне, не в текстовом поле и не в активном модальном окне. Клавиши своей панели можно обрабатывать обычным listener внутри iframe — это не глобальная привязка редактора.

### 9.11 Собственное хранилище, ресурсы и настройки

| Метод | Результат |
| --- | --- |
| `api.storage.get(key)` | Сохранённое значение или `null` |
| `api.storage.set(key,value)` | `true` |
| `api.assets.read(path)` | **Синхронно** текст UTF-8 или data URL растрового изображения из пакета |
| `api.settings.read()` | Объект текущих значений объявленных настроек |
| `api.settings.update(patch)` | Полный объект настроек после записи |
| `api.onSettingsChanged(handler)` | **Синхронно** `{dispose()}` |
| `api.onProjectChanged(handler)` | **Синхронно** `{dispose()}`; см. жизненный цикл |

`storage` доступен только текущему аддону. Ключ — строка до 100 символов, запрещены `__proto__`, `constructor`, `prototype`. Используй JSON-совместимые значения; длина сериализованного значения не более 100 000 символов на ключ. Публичных `storage.list/delete` нет; для обозначения отсутствия можно записать `null` или обновить собственную структуру.

Не используй `localStorage`/IndexedDB iframe: sandbox имеет непрозрачный origin. `api.storage` работает через хост. Включение/выключение сохраняет данные, Remove удаляет их вместе с пакетом. Объявленные `settings` хранятся отдельно от произвольного `storage`.

`contributes.settings`: до 30 определений. Уникальный `key` соответствует `^[-a-zA-Z0-9._]{1,80}$`, кроме трёх запрещённых имён; `title` — непустая строка до 120 символов; optional `description` — до 1000. Типы только `boolean`, `string`, `number`. Для числа возможны конечные `min/max`, `min <= max`; для строки максимум 2000 символов. `default` должен соответствовать типу и ограничениям.

Если default отсутствует: boolean → false, string → `''`, number → 0, либо положительный min/отрицательный max, если 0 выходит из такого диапазона. В `settings.update` принимаются только объявленные ключи, с проверкой типов без автоматического приведения. Передавать весь новый manifest/менять определения настроек этим методом нельзя.

Каждая запись пакета сохраняется в IndexedDB до изменения значения в памяти. Параллельные записи одного аддона упорядочены, в том числе при обновлении/удалении; ошибка не должна использоваться как подтверждение сохранения. Сбой хранилища возвращает rejection — покажи его пользователю. Изменившийся/заменённый пакет может вернуть `Plugin changed. Try again.`

## 10. Панели: правильная работа DOM и соответствие интерфейсу

`ui.showPanel` показывает **тот же iframe**, в котором работает `main.js`, и присваивает HTML контейнеру `#panel`. Разные объявленные панели одного аддона разделяют этот контейнер и состояние модуля. Повторное открытие заменяет DOM, поэтому заново привязывай обработчики. Закрытие окна панели не выключает аддон.

`html` — строка до 200 000 символов. Встроенные `<script>` при установке через `innerHTML` не исполняются. Обработчики устанавливай из `main.js` **после** `await showPanel`:

```js
await api.ui.showPanel('my.addon.panel', `
  <h2>My addon</h2>
  <input id="myFile" type="file" accept="image/png,image/jpeg,image/webp,image/avif">
  <button id="myRun" type="button">Run</button>
  <p id="myStatus" role="status" aria-live="polite"></p>
`);
document.querySelector('#myRun').onclick = async () => {
  try {
    // Выполни действие через API.
  } catch (error) {
    document.querySelector('#myStatus').textContent = error.message;
  }
};
```

Хост уже передаёт тему и общие стили для file inputs, text inputs, select, textarea и фокуса. Используй `font: inherit`, системные шрифты и CSS-переменные с fallback; не фиксируй белые фоны/чёрный текст. Общие кнопки можно оформить локальным CSS:

```css
button {
  font: inherit; padding: 7px 12px; border-radius: 6px;
  border: 1px solid var(--line, #454545);
  background: var(--vscode-button-bg, #3b3b3b);
  color: var(--vscode-button-fg, var(--text, #ddd));
}
.muted { color: var(--muted, #aaa); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
input, select, textarea { max-width: 100%; box-sizing: border-box; }
```

Панель автоматически получает обновления цветовых переменных при смене темы. Отдельного публичного события темы нет; для программного чтения используй `theme.read`. Размер UI родительского приложения не является обещанием масштабировать произвольный пиксельный layout аддона: делай панель адаптивной, с переносом текста/кнопок, без фиксированной ширины больше iframe. Сохраняй aria-label, состояния disabled и удобные для касания кнопки.

## 11. Sandbox и неподдерживаемые возможности

iframe имеет только `sandbox="allow-scripts"`, **без** `allow-same-origin` и `allow-downloads`. Его CSP:

```text
default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval';
style-src 'unsafe-inline'; img-src data:; connect-src 'none';
form-action 'none'; base-uri 'none'
```

Доступны собственный DOM, обычный JavaScript, таймеры, FileReader и локальные пользовательские File-объекты из file input. Сетевые fetch/XHR/WebSocket, внешние скрипты/картинки/шрифты, доступ к DOM/хранилищу редактора, произвольные всплывающие окна/навигация/скачивание через iframe не являются предоставленными возможностями. Картинки в панели должны быть data URL, включая SVG data URL.

Недоступны через community SDK:

- VSCode `.vsix`, Marketplace, Node.js, загрузка npm-пакетов во время работы.
- Межаддонные зависимости, вызов произвольной команды другого аддона и API установки/обновления пакетов.
- Произвольный CSS или JavaScript в родительской странице; создание новых системных SVG-символов.
- Прямые ссылки на Three.js renderer, произвольные материалы, orbit-controls и собственный движок панорам. В SDK 1.5 доступны декларативные 3D-якоря, геометрия, глубина и управление камерой: [SCENE_SDK.md](SCENE_SDK.md).
- Новые режимы повторения, типы локусов, форматы проекта или обработчики импорта/экспорта.
- Публичные API Undo-транзакций, Change history, Workspace Presets, системных настроек или регистрации собственных разделов Settings.
- Прямой доступ к файлам устройства без выбора пользователем или к произвольной файловой системе.

Некоторые штатные действия доступны через `ui.execute` и его динамический список; это не открывает их внутренние параметры/объекты. Реализацию системного модуля можно менять только как код самого приложения.

## 12. Системные аддоны: отдельный доверенный механизм

Системные аддоны — JS-модули, включённые в исходный код приложения, не загружаемые ZIP. Они работают в контексте редактора и регистрируются внутренним глобальным `registerSystemAddon(definition)`:

```js
registerSystemAddon({
  id: 'system.my-module',
  title: 'My module',
  description: 'Built-in module description.',
  settingsPage: 'my-module', // необязательно, существующая внутренняя страница
  activate() { /* установить обработчики приложения */ },
  deactivate() { /* снять обработчики приложения */ }
});
```

Внутренний ID соответствует `^system\.[a-z-]+$`; повторная регистрация запрещена. Модуль по умолчанию включён, если браузерная настройка не содержит false; activate вызывается при регистрации/включении. Включение сохраняется отдельно в `palace.systemAddons`. Внутренний `window.PalaceSystemAddons.list()` возвращает `{id,title,enabled}[]`, `.setEnabled(id,boolean)` переключает модуль. Это **не свойства SDK api** и не доступны sandbox-расширению.

Текущие зарегистрированные системные модули:

| ID | Назначение |
| --- | --- |
| `system.history` | Change history: локальные версии, просмотр изменений, восстановление с резервной версией; до 50 версий на дворец |
| `system.command-palette` | Command Palette: поиск штатных и активных аддонных команд |
| `system.workspace-presets` | Workspace Presets: сохранение/импорт/экспорт тем, значков, размеров, видимости и компоновки без замены содержимого дворца |

Они находятся в **Settings → Core plugins**, имеют переключатели и шестерёнки настроек и не зависят от community Modular mode. Подразделы Canvas, Camera editor, 3D viewer, Minimap также показывают группы встроенных инструментов; не каждый такой раздел является отдельным зарегистрированным lifecycle-аддоном.

Для разработки нового системного модуля потребуется менять исходники приложения, подключать файл в `index.max.html`, создавать внутреннюю страницу при необходимости, добавлять файл в список `scripts/update-offline.cjs`, запускать сборку `npm run build` и проверять регрессию. Редактируемый HTML — `index.max.html`; `index.html` — генерируемая минифицированная версия. Для обычного ZIP-аддона эти шаги не нужны.

## 13. Проверка готового аддона

1. Убедись, что manifest в корне ZIP и `main` существует; проверь ID, права и engines.
2. Установи пакет через Community plugins, дождись **Active**, открой **Settings & log**.
3. Проверь каждую команду, activityBar/toolbar, собственную панель и объявленные настройки.
4. Проверь пустой проект, отсутствующие этажи/камеры/исходный ZIP; ошибки должны объясняться, а не ломать хост.
5. Проверь режим View и повторение: запрещённая запись должна быть обработана.
6. Для записи проекта проверь Undo/Redo и экспорт с повторным открытием.
7. Проверь сохранение storage/settings после перезагрузки, disable/enable и update, включая несовместимую версию/конфликт клавиши.
8. Для UI проверь светлую/тёмную тему, Small/Medium/Large, телефонную ширину и горизонтальный экран.
9. Проверь параллельные запросы и ошибки записи. Не обещай пользовательское сохранение после rejection.

В репозитории:

```sh
npm test
PALACE_TEST_FILES=addons.cjs,interfaces.cjs,appearance.cjs,extension-operations.cjs,addon-management.cjs,audit-regression.cjs npm test
PALACE_TEST_FILES=addons.cjs PALACE_PROFILES=Android npm test
```

Браузерные тесты — `test/*.cjs`, общие фикстуры — `test/support/fixtures.cjs`. Для sandbox-iframe при тестах с перезагрузкой разрешай service workers: опция Playwright `serviceWorkers:'block'` внедряет обращение к `navigator.serviceWorker` во все iframe, что может вызвать ошибку у opaque-origin аддона. Это не повод добавлять `allow-same-origin` в production sandbox.

## 14. Полный рабочий шаблон и дополнительные материалы

В комплекте этой документации:

- `palace-sdk.d.ts` — типы всех публичных методов SDK 1.7.0; файл для разработки, не исполняемый SDK и не источник Node.js API.
- `starter/manifest.json`, `starter/main.js`, `starter/icon.svg` — рабочий минимальный аддон с панелью, кнопками, локусом, настройками, storage и горячей клавишей.
- `starter.palace-addon` — собранный тот же пример для установки в Community plugins.

Для производства переименуй namespace `ai.starter` во всех manifest-ID, JS-ID и ID привязки. Добавляй права/методы только для конкретной функции; используй этот справочник для расширения шаблона.

### 14.1 Самодостаточные исходники шаблона

`manifest.json`:

```json
{
  "id": "ai.starter",
  "name": "AI starter",
  "description": "Working SDK 1.4 example: overview panel, loci, settings, storage and a shortcut.",
  "version": "1.0.0",
  "apiVersion": 1,
  "engines": {"palace": ">=1.4.0 <2.0.0"},
  "main": "main.js",
  "permissions": ["project.read", "markers.write", "ui.contribute", "keybindings.write"],
  "contributes": {
    "commands": [
      {"id": "ai.starter.open", "title": "Open AI starter"},
      {"id": "ai.starter.center", "title": "Add locus at center"}
    ],
    "panels": [{"id": "ai.starter.panel", "title": "AI starter"}],
    "activityBar": [{"id": "ai.starter.activity", "title": "AI starter", "icon": "icon.svg", "command": "ai.starter.open"}],
    "toolbars": [{"id": "ai.starter.center-tool", "title": "Add locus at center", "icon": "pin", "location": "plan", "command": "ai.starter.center"}],
    "settings": [
      {"key": "note", "title": "Default note", "description": "Text saved in a newly created locus.", "type": "string", "default": "Created by AI starter"},
      {"key": "showCount", "title": "Show locus count", "type": "boolean", "default": true}
    ]
  }
}
```

`main.js`:

```js
'use strict';

let disposables = [], settings = {}, addonApi, created = 0, creationQueue = Promise.resolve();

function paint(project) {
  const name = document.querySelector('#starterName');
  if (!name) return;
  name.textContent = project.name;
  const count = document.querySelector('#starterCount');
  count.hidden = !settings.showCount;
  count.textContent = 'Loci: ' + project.levels.reduce((sum, floor) => sum + floor.markers.length, 0);
  document.querySelector('#starterCreated').textContent = 'Created by this addon: ' + created;
  const floor = project.levels[project.active];
  document.querySelector('#starterAdd').disabled = !floor || !(floor.w > 0 && floor.h > 0) || project.mode !== 'edit';
}

async function refresh() { paint(await addonApi.project.read()); }
function showError(error) {
  const status = document.querySelector('#starterStatus');
  if (status) status.textContent = error.message || String(error);
}

function addCenter() {
  const task = creationQueue.then(createCenter);
  creationQueue = task.catch(() => {});
  return task;
}

async function createCenter() {
  const project = await addonApi.project.read(), floor = project.levels[project.active];
  if (!floor || !(floor.w > 0 && floor.h > 0)) throw new Error('Open a floor plan first.');
  const result = await addonApi.markers.add({level: floor.index, x: floor.w / 2, y: floor.h / 2, note: settings.note});
  // A storage failure does not undo the locus already created in the project.
  const next = created + 1;
  try { await addonApi.storage.set('created', next); created = next; }
  catch (error) { showError(new Error('Locus added, but the addon counter could not be saved: ' + error.message)); }
  await refresh();
  await addonApi.ui.showMessage('Locus added at the center of the floor');
  return result;
}

async function openPanel() {
  await addonApi.ui.showPanel('ai.starter.panel', `
    <style>
      h2{font-size:20px;margin:0 0 12px}.muted{color:var(--muted,#aaa)}
      button{font:inherit;padding:9px 12px;border-radius:6px;border:1px solid var(--line,#454545);background:var(--vscode-button-bg,#3b3b3b);color:var(--vscode-button-fg,var(--text,#ddd))}
      .actions{display:flex;gap:8px;flex-wrap:wrap}label{display:block;margin:12px 0}input[type=text]{width:100%;box-sizing:border-box}
      p{overflow-wrap:anywhere}#starterStatus{min-height:1.5em}
    </style>
    <h2>AI starter</h2><p id="starterName"></p><p id="starterCount"></p>
    <p id="starterCreated" class="muted"></p>
    <label>Default note<input id="starterNote" type="text" maxlength="2000" aria-label="Default note"></label>
    <div class="actions"><button id="starterAdd" type="button">Add locus at center</button><button id="starterSave" type="button">Save note</button></div>
    <p id="starterStatus" role="status" aria-live="polite"></p>
  `);
  const note = document.querySelector('#starterNote'); note.value = settings.note;
  document.querySelector('#starterAdd').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await addCenter(); } catch (error) { showError(error); }
    finally { try { await refresh(); } catch (error) { showError(error); } }
  };
  document.querySelector('#starterSave').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      settings = await addonApi.settings.update({note: note.value});
      document.querySelector('#starterStatus').textContent = 'Note saved.';
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  };
  await refresh();
}

exports.activate = async api => {
  addonApi = api; settings = await api.settings.read();
  const stored = await api.storage.get('created'); created = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
  disposables.push(api.commands.register('ai.starter.open', openPanel));
  disposables.push(api.commands.register('ai.starter.center', addCenter));
  disposables.push(api.onProjectChanged(paint));
  disposables.push(api.onSettingsChanged(next => {
    settings = next;
    const note = document.querySelector('#starterNote');
    if (note && document.activeElement !== note) note.value = next.note;
    refresh().catch(showError);
  }));
  try {
    await api.keybindings.register({id: 'ai.starter.open-key', command: 'ai.starter.open', key: 'Ctrl+Alt+Shift+KeyU'});
  } catch (error) {
    await api.ui.showMessage('AI starter shortcut unavailable: ' + error.message);
  }
};

exports.deactivate = () => {
  for (const disposable of disposables) disposable.dispose();
  disposables = [];
};
```

`icon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#3592c4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4zM12 4v8h8M4 12h8v8"/><circle cx="8" cy="8" r="1" fill="#3592c4"/></svg>
```

Сохрани эти три файла в одной папке и упакуй её содержимое, как указано в разделе 4. Пример обработчиков не полагается на исполнение script из HTML и отдельно обрабатывает частичное выполнение операции: уже добавленный локус не исчезнет, если последующая запись счётчика в storage завершится ошибкой.

## Приложение A. Встроенные имена значков для manifest

Имена без `i-`; для каталога замены значков прибавляй `i-`:

```text
user key plan cube dollhouse floorplan flag edit merge unmerge move layers
plus minus folder save upload split window swap cursor pin fit arrow-up
arrow-down crop rotate flip trash grip dot arrow-right turn-cw turn-ccw close
eye-hidden camera-edit download camera gear contrast expand collapse search
braces palette check video eye aperture target cam-move moon keyboard sun
binoculars atom film polaroid lens camera-solid viewfinder compass tv pano360
globe radar transparent
```

## Приложение B. Исходники, определяющие контракт

| Файл | Роль |
| --- | --- |
| `addons.js` | Проверка ZIP/manifest, sandbox, SDK, RPC, базовые разрешения, команды и lifecycle |
| `app-api.js` | Компактный проект, локусы, метаданные и базовая тема |
| `interfaces.js` | Планы/стены, просмотр/тур, кнопки, безопасные SVG-слои, видимость инструментов |
| `appearance.js` | Валидированные темы и наборы SVG-путей, ownership/lifecycle оформления |
| `extension-operations.js` | Камеры/панорамы, исходный архив/meta.json и пользовательские горячие клавиши |
| `addon-management.js` | SDK 1.7, engines, объявленные настройки/события, обновления и журнал |
| `ui-controls.js` | Общие стили iframe и расширенный ThemeState |
| `system-addons.js` | Доверенные системные модули; не community SDK |
| `history-addon.js`, `command-palette.js`, `workspace-presets.js` | Реализации трёх встроенных модулей |
| `scripts/package-addon.cjs` | Сборка локального ZIP-пакета |

При разработке для будущей версии сначала проверь `api.version` и фактические исходники. Не добавляй несуществующий API на основании похожих названий в VSCode или Obsidian.

## SDK 1.5: 3D anchors, scenes, camera and playback

Полное дополнение к этому руководству: [SCENE_SDK.md](SCENE_SDK.md). Типы всех новых API включены в `docs/addons/palace-sdk.d.ts`. Пять новых permissions: `scene.read`, `scene.write`, `camera.control`, `anchors.read`, `anchors.write`. Формат manifest.apiVersion остаётся 1.

## SDK 1.6: World Space

Полный контракт глобальных объектов и явно зарегистрированных камер — [WORLD_SDK.md](WORLD_SDK.md). Сохранены все локальные API SDK 1.5; новый `tour.world` добавляет 22 метода, включая CRUD, преобразования координат, окклюзию и события.

## SDK 1.7: spherical calibration core

Полный контракт `tour.world.calibration`, математический алгоритм, единицы, фоновые задания, подтверждённое применение и ограничения — [CALIBRATION_SDK.md](CALIBRATION_SDK.md). Новый интерфейс калибровки не создаётся. Системные модули получают тот же контракт через `window.PalaceAPI.tour.world.calibration`.
