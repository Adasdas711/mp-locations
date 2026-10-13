# Аддоны PALACE (API v1)

Полная сверенная справка SDK **1.4.0** для передачи другому ИИ: [ADDONS_AI_GUIDE.md](ADDONS_AI_GUIDE.md). В ней объединены текущие методы, разрешения, ограничения и рабочий шаблон; разделы ниже также сохраняют сведения о предыдущих версиях API.

Это собственные расширения PALACE по модели VSCode: manifest, активация, команды, панели и локальное хранилище. Готовые VSCode `.vsix`, Node.js API, ESM и Marketplace не поддерживаются.

Основной код разделён на `app.js` (редактор), `themes.js`, `theme-picker.js`, `mobile.js`, `persistence.js`, `transitions.js`, `app-api.js` (граница API) и `addons.js` (менеджер и хост расширений). Для разработки и запуска аддона сборка приложения не нужна. Менеджер открывается через **Settings → Community plugins**. `Ctrl+Shift+P` (на Mac также `Cmd+Shift+P`) открывает поиск установленных аддонов и их команд.

## Установка

Откройте **Настройки → Аддоны** и нажмите **Установить аддон**. Выберите или перетащите ZIP / `.palace-addon` в появившийся блок внутри меню. В корне должны лежать `manifest.json` и JS-файл, указанный в `main`. Перед запуском интерфейс показывает имя, версию и разрешения. Нажмите **Установить**. Пакет сохраняется в IndexedDB этого браузера и восстанавливается при следующем запуске. Можно отключить отдельный аддон, удалить его или выключить весь модульный режим. Пакет с тем же id заменяет установленную версию, сохраняя её собственные настройки.

Пример: [`addons/example.palace-addon`](addons/example.palace-addon). Его исходники лежат в `addons/example/`.

```sh
node scripts/package-addon.cjs addons/example /tmp/example.palace-addon
```

Поддерживаются текстовые UTF-8 файлы и изображения PNG/JPEG/WebP/AVIF, до 100 файлов и до 8 МБ в распакованном виде. Другие ресурсы можно включать как data URL в текстовые файлы. `require('./utils')` загружает относительные CommonJS-модули из пакета. Внешние пакеты и пути с `..` не поддерживаются.

## Manifest

```json
{
  "id": "my.addon",
  "name": "Мой аддон",
  "version": "1.0.0",
  "apiVersion": 1,
  "main": "main.js",
  "permissions": ["project.read", "markers.write"],
  "contributes": {
    "commands": [{"id": "my.addon.center", "title": "Добавить локус"}],
    "panels": [{"id": "my.addon.panel", "title": "Моя панель"}]
  }
}
```

Все id команд и панелей должны начинаться с id аддона и точки. Разрешения: `project.read`, `markers.write`, `metadata.write`. Команды отображаются в менеджере; незаявленные команды и панели не принимаются.

## Активация

```js
exports.activate = api => {
  api.commands.register('my.addon.center', async () => {
    const project = await api.project.read();
    const floor = project.levels[project.active];
    if (!floor) throw new Error('Нет активного плана');
    await api.markers.add({level: floor.index, x: floor.w / 2, y: floor.h / 2, note: 'Центр'});
    await api.ui.showMessage('Локус добавлен');
  });
};
```

| API | Поведение |
| --- | --- |
| `api.commands.register(id, handler)` | Регистрирует асинхронную команду; возвращает `{dispose()}` |
| `api.project.read()` | Возвращает копию метаданных, этажей, локусов и камер; без изображений и панорамных байтов |
| `api.project.updateMetadata(patch)` | Изменяет `name`, `purpose`, `source`, `explain`, `notes`; требует `metadata.write` |
| `api.markers.add({level,x,y,note})` | Добавляет локус в границах указанного этажа; требует `markers.write` |
| `api.markers.remove({level,index})` | Удаляет локус; требует `markers.write` |
| `api.ui.showMessage(text)` | Показывает сообщение в строке состояния |
| `api.ui.showPanel(id, html)` | Открывает объявленную HTML-панель в изолированном iframe |
| `api.theme.read()` | Возвращает имя темы и основные цвета |
| `api.storage.get(key)` / `set(key,value)` | Читает/сохраняет собственные JSON-настройки аддона |
| `api.assets.read(path)` | Синхронно читает текстовый ресурс внутри пакета |
| `api.onProjectChanged(handler)` | Подписка на изменения проекта; требует `project.read`, возвращает `{dispose()}` |

Изменение проекта разрешено только в режиме редактирования, вне повторения; правки участвуют в отмене, автосохранении и экспорте. API возвращает Promise, кроме регистрации, assets и подписки. Исключение команды отображается в менеджере. Ошибка активации отключает её команды. Отключение уничтожает iframe; `deactivate` — необязательный хук, на завершение асинхронной очистки полагаться нельзя.

## Изоляция и ограничения

Код работает в iframe с `sandbox="allow-scripts"`, без доступа к DOM редактора, его cookies и хранилищу. Сообщения API проверяются по источнику iframe и отдельному каналу. CSP блокирует внешние скрипты и сетевые ресурсы панели; разрешения проекта проверяются на стороне редактора. Устанавливайте пакеты из понятных вам источников: sandbox не гарантирует защиту от чрезмерного потребления памяти или процессора.

HTML панели находится внутри собственного iframe. Экранируйте пользовательские данные при построении HTML (пример `utils.js`). Аддоны не экспортируются вместе с дворцом: их устанавливают отдельно на каждом браузере. Хранилище аддонов и дворцов удаляется при очистке данных сайта.

## Интерфейсы плана, 3D и инструментов (API 1.1)

Сохраняется `apiVersion: 1`: старые аддоны совместимы. Новые разрешения:

| Разрешение | Доступ |
| --- | --- |
| `plan.read` | Чтение этажа, включая локальное изображение |
| `plan.write` | Создание/удаление/переименование/перестановка/совмещение/разделение этажей, стены и поворот |
| `tour.read` | Камеры и локальные панорамные данные |
| `tour.write` | Метаданные камер, положение на плане, переходы и начальная камера |
| `view.control` | Выбор этажа/камеры, план/3D/разделение, масштаб и ракурс |
| `ui.control` | Системные команды, тема, размер UI и видимость инструментов |
| `ui.contribute` | Собственные значки, панели инструментов и графические слои |

```json
{
  "permissions": ["project.read", "ui.contribute", "view.control"],
  "contributes": {
    "commands": [{"id": "my.addon.open", "title": "Моя панель"}],
    "panels": [{"id": "my.addon.panel", "title": "Моя панель"}],
    "activityBar": [{"id": "my.addon.activity", "title": "Мой аддон", "icon": "icon.svg", "command": "my.addon.open"}],
    "toolbars": [{"id": "my.addon.tool", "title": "Открыть", "location": "tour", "icon": "cube", "command": "my.addon.open"}]
  }
}
```

Значок: имя встроенной иконки (`pin`, `cube`, `floorplan`, `braces` и др.) либо файл SVG/PNG/JPEG/WebP/AVIF из пакета. Для `toolbars.location` доступны `plan`, `tour`, `header`, `status`. Кнопки выполняют зарегистрированную команду. Отключение/удаление аддона удаляет его кнопки и графические слои. Пакет поддерживает бинарные изображения этих форматов; `api.assets.read()` возвращает для них data URL.

| API | Параметры |
| --- | --- |
| `api.plan.read(level)` | Полная копия этажа; без аргумента — активный |
| `api.plan.add({name,src,floorId})` | Добавить этаж из локального data URL изображения |
| `api.plan.remove(level)` / `rename({level,name})` | Удалить / переименовать этаж |
| `api.plan.select(level)` / `move({from,to})` | Выбрать / переставить этаж |
| `api.plan.merge({from,to})` / `split(level)` | Совместить / разделить планы; совмещение открывает штатный режим размещения |
| `api.plan.transform({rotation})` | Поворот активного плана |
| `api.plan.walls.add({level,x1,y1,x2,y2})` / `remove({level,index})` | Добавить / удалить стену |
| `api.markers.update({level,index,patch})` | Поля `x`, `y`, `note`, `localPano` |
| `api.view.read()` / `set({layout,planView,zoom})` | `layout`: plan/tour/split/split-rev; `planView`: 2d/3d |
| `api.tour.read()` / `select(id)` | Прочитать камеры / открыть камеру |
| `api.tour.pose({yaw,pitch,fov})` | Ракурс активной панорамы |
| `api.tour.update({id,patch})` | `room`, `hidden`, `headingDeg`, `navYawOffsetDeg`, `planPx` |
| `api.tour.connect({from,to,add})` / `setStart(id)` | Двусторонний переход / начальная камера; `null` сбрасывает начальную |
| `api.ui.commands()` / `execute(id)` | Список штатных команд / их выполнение через обычный интерфейс |
| `api.ui.tools()` / `setToolVisible(id,visible)` | Инструменты и сохранение видимости |
| `api.ui.themes()` / `theme(id)` / `scale(0|1|2)` | Темы, переключение темы, размер UI |
| `api.ui.overlay({id,location,shapes})` | Графический слой поверх плана или панорамы |

Слой поддерживает безопасные фигуры `circle`, `rect`, `line`, `text`, до 500 фигур. Для плана координаты совпадают с координатами изображения; для 3D-экрана используется область 1000×1000. Пример:

```js
await api.ui.overlay({
  id: 'my.addon.selection', location: 'plan',
  shapes: [{type: 'circle', cx: 120, cy: 80, r: 20, stroke: '#4da3ff', fill: 'none'}]
});
// Удаление слоя:
await api.ui.overlay({id: 'my.addon.selection', location: 'plan', remove: true});
```

HTML панелей остаётся внутри изолированного iframe. Прямой DOM редактора и произвольное выполнение кода в его контексте не открываются. Изменения данных разрешены только в редактировании, вне повторения; координаты и поля проверяются на стороне приложения. Это доступ через интерфейсы, а не подмена внутренних объектов редактора.

## Настройки инструментов

Кнопка **Настройка инструментов** на боковой панели или `Ctrl+Alt+T` открывает список системных и аддонных инструментов. Можно скрывать значки, кнопки, команды в менеджере аддонов и графические слои. Выбор сохраняется в браузере и переживает перерисовку, перезапуск и повторное включение аддона. **Показать все** сбрасывает настройки. Кнопка самих настроек остаётся доступной, чтобы можно было вернуть скрытые инструменты.

Скрытие меняет интерфейс, а не права аддона или доступность команды через API/клавиши. Настройки не заставляют инструменты редактирования появляться в режиме просмотра и не отменяют ограничения текущего режима.

Пошаговое объяснение обмена с редактором и пример аддона: [API_GUIDE.md](API_GUIDE.md).

## Темы и иконки (API 1.2)

Отдельный готовый аддон: [appearance.palace-addon](addons/appearance.palace-addon); установка и формат своих наборов: [инструкция](addons/appearance/README.md).

- `await api.ui.registerAppearance({themes, iconThemes})` — регистрация/обновление каталога данного аддона; требует `ui.contribute`. ID начинается с ID аддона и точки. Проверка всех элементов выполняется до регистрации.
- `await api.ui.removeAppearance()` — снять каталог данного аддона; требует `ui.contribute`.
- `await api.ui.iconThemes()` — список `{id,title,active}`.
- `await api.ui.iconTheme(id)` — выбрать набор иконок; требует `ui.control`. `system.default` восстанавливает исходные символы.
- Темы доступны через существующие `api.ui.themes()` / `api.ui.theme(id)` и штатный выбор темы.

Тема наследует встроенную `base` и переопределяет проверенные токены `colors` / `canvas`; режим — `dark` / `light`. Набор иконок задаёт массивы SVG-путей `{d,filled}` для существующих `i-*` символов. Произвольный CSS, скрипты, URL и SVG-разметка не принимаются. Каталог живёт пока работает его аддон; отключение, удаление и ошибка активации снимают оформление. Для восстановления импортированного каталога аддон сохраняет JSON через `api.storage` и регистрирует его в `activate`. Выбор темы/иконок сохраняет сам редактор. `apiVersion: 1` остаётся совместимым.

## Камеры, архив и горячие клавиши (API 1.3)

Остаётся `apiVersion: 1`. Добавлены разрешения `archive.read`, `archive.write`, `keybindings.write`; операции камеры используют существующее `tour.write`. Все методы ниже возвращают Promise.

| Метод | Действие |
| --- | --- |
| `api.tour.add({id?,level?,room?,planPx?,src?})` | Создать камеру. `level` — индекс этажа, по умолчанию активный; без `id` генерируется UUID. `planPx` — `{x,y}` в координатах изображения плана. Без `src` создаётся камера без фото |
| `api.tour.loadPanorama({id,src})` | Загрузить/заменить эквидистантную панораму существующей камеры |
| `api.tour.remove(id)` | Удалить камеру, входящие/исходящие переходы, назначение начальной и привязки локусов; отмена восстанавливает их |
| `api.archive.list()` | Список файлов открытого исходного архива: `[{path}]`, с учётом правок |
| `api.archive.read({path,encoding?})` | `{path,encoding,data}`; `encoding`: `text` (UTF-8, по умолчанию) / `base64` |
| `api.archive.write({path,encoding,data})` | Добавить или заменить текстовый/бинарный файл; UTF-8 текст или base64 |
| `api.archive.remove(path)` | Удалить файл из копии исходного архива |
| `api.archive.meta.read()` | Объект `meta.json`; `null`, если отсутствует |
| `api.archive.meta.write(object)` | Заменить `meta.json`; `null` удаляет его |
| `api.archive.export()` | Вернуть копию исходного ZIP с правками: `{name,encoding:'base64',data}` |
| `api.archive.download()` | Скачать копию исходного ZIP с правками; вернуть `{name}` |
| `api.keybindings.register({id,command,key})` | Привязать зарегистрированную команду аддона; вернуть `{id,key}` |
| `api.keybindings.unregister(id)` | Снять собственную привязку |
| `api.keybindings.list()` | Список системных и аддонных сочетаний: `[{id,title,key,owner}]` |

Для чтения/экспорта/скачивания архива требуется `archive.read`, для изменения — `archive.write`. Исходный архив должен быть открыт в приложении. Правки файлов и `meta.json` входят в историю отмены и локальное восстановление. Камера принимает `src` как локальный data URL PNG/JPEG/WebP/AVIF до 16 МБ; для файла, выбранного в панели аддона, получите data URL через FileReader. Камера без позиции доступна в выборе панорам; её можно поставить на план позднее. На этаже без `floorId` идентификатор назначается автоматически.

`archive.download/export` изменяет **исходную копию ZIP**. Правка его `palace.json`, `links.json` или изображения не перестраивает открытый редактор автоматически: откройте экспортированный архив для применения этих служебных изменений. Штатный экспорт `.mpalace/.mplace` создаёт файлы проекта из текущего состояния, добавляет новые дополнительные файлы аддона и актуальный `meta.json`; его сформированные файлы имеют приоритет над правками исходных файлов. Скачивание исходной копии из редактора `meta.json` тоже учитывает изменения через API.

Ограничения файлов: 16 МБ на файл, 32 МБ и 200 изменений в совокупности; `meta.json` — JSON-объект до 1 МБ. Абсолютные пути, `..`, обратные слеши и управляющие символы отклоняются. Все записи требуют режима редактирования вне повторения. Чтение бинарного файла выполняйте с `encoding:'base64'`.

Пример после объявления команды `my.addon.create` в manifest и разрешений `tour.write`, `archive.write`, `keybindings.write`:

```js
exports.activate = async api => {
  api.commands.register('my.addon.create', async () => {
    const {id} = await api.tour.add({
      level: 0, room: 'Новая камера', planPx: {x: 120, y: 90},
      src: api.assets.read('panorama.jpg')
    });
    await api.tour.setStart(id);
    await api.archive.meta.write({addon: 'my.addon'});
    await api.archive.write({path: 'addon/info.txt', encoding: 'text', data: 'Создано аддоном'});
  });
  await api.keybindings.register({
    id: 'my.addon.create-key', command: 'my.addon.create', key: 'Ctrl+Alt+Shift+KeyU'
  });
};
```

ID привязки начинается с ID аддона и точки; команда должна быть объявлена в manifest и зарегистрирована до привязки. До 30 сочетаний на аддон. Формат клавиш использует `KeyboardEvent.code`: `KeyU`, `Digit1`, `F8` и т. п.; порядок модификаторов — `Ctrl+Alt+Shift+`. На macOS `Ctrl` соответствует также Cmd, как в штатных сочетаниях PALACE. Занятые сочетания и фиксированные системные действия отклоняются. Привязки видны в штатных настройках горячих клавиш; пользователь может их переназначить. Аддон регистрирует сочетания в `activate`, чтобы восстановить их после перезагрузки. Отключение, удаление и ошибка активации снимают их. Они работают в основном окне приложения, вне модальных окон и текстовых полей; собственная панель в iframe может обрабатывать свои клавиши локально.

## API 1.4: compatibility and plugin settings

Packages continue to use `apiVersion: 1`. Optional `engines.palace` specifies the sandbox SDK version required by the plugin. Supported expressions use full `major.minor.patch` versions: exact versions, `^`, `~`, `>=`, `<=`, `>`, `<`, or whitespace-separated comparisons (all must match). Omit the field or use `*` for compatibility with the existing package API.

```json
{
  "engines": {"palace": ">=1.4.0 <2.0.0"},
  "contributes": {
    "settings": [
      {"key": "showLabels", "title": "Show labels", "type": "boolean", "default": true},
      {"key": "title", "title": "Panel title", "type": "string", "default": "My panel"},
      {"key": "limit", "title": "Item limit", "type": "number", "min": 1, "max": 100, "default": 10}
    ]
  }
}
```

A plugin can declare up to 30 settings. Keys are unique and scoped to its own plugin; values are validated against the declarations. Optional `description` supplies helper text in the manager. Strings are limited to 2,000 characters. Settings are persisted in the installed package record, independently from `api.storage`.

```js
exports.activate = async api => {
  const values = await api.settings.read();
  await api.settings.update({showLabels: false});
  const subscription = api.onSettingsChanged(next => {
    // Apply changes without restarting the plugin.
  });
};
```

**Settings & log** exposes these settings and the current-session activity/error log. Updating a ZIP or `.palace-addon` preserves compatible setting values, storage, and disabled state. New permissions are displayed in the confirmation preview. Updates and downgrades require selecting and confirming a package; there is no remote plugin registry or automatic network update service.

Built-in system addons are a separate, trusted application module with `registerSystemAddon({id, title, description, activate, deactivate})` lifecycle hooks. They appear under **Core plugins** and are independent of the community modular-mode switch. The bundled `system.history` addon records local project versions; community packages retain their isolated sandbox and cannot register native system addons.
