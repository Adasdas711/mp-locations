# Аддоны PALACE (API v1)

Это собственные расширения PALACE по модели VSCode: manifest, активация, команды, панели и локальное хранилище. Готовые VSCode `.vsix`, Node.js API, ESM и Marketplace не поддерживаются.

Основной код разделён на `app.js` (редактор), `themes.js`, `theme-picker.js`, `mobile.js`, `persistence.js`, `transitions.js`, `app-api.js` (граница API) и `addons.js` (менеджер и хост расширений). Для разработки и запуска сборка не нужна. Кнопка **Аддоны** в боковой панели открывает менеджер. `Ctrl+Shift+P` (на Mac также `Cmd+Shift+P`) открывает поиск установленных аддонов и их команд.

## Установка

Загрузите ZIP или `.palace-addon`. В корне должны лежать `manifest.json` и JS-файл, указанный в `main`. Перед запуском интерфейс показывает имя, версию и разрешения. Нажмите **Установить**. Пакет сохраняется в IndexedDB этого браузера и восстанавливается при следующем запуске. Можно отключить отдельный аддон, удалить его или выключить весь модульный режим. Пакет с тем же id заменяет установленную версию, сохраняя её собственные настройки.

Пример: [`addons/example.palace-addon`](addons/example.palace-addon). Его исходники лежат в `addons/example/`.

```sh
node scripts/package-addon.cjs addons/example /tmp/example.palace-addon
```

Поддерживаются UTF-8 файлы, до 100 файлов и до 8 МБ в распакованном виде. Бинарные ресурсы можно включать как data URL в текстовые файлы. `require('./utils')` загружает относительные CommonJS-модули из пакета. Внешние пакеты и пути с `..` не поддерживаются.

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
