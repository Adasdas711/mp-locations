# PALACE / Memory Mapper

Статический редактор дворцов памяти. Для запуска не нужны сборка, серверная база данных или ключи API:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory .
```

Для установки на телефон и офлайн-кэша разместите всю папку приложения на HTTPS-сайте. На localhost кэш также работает. Не открывайте приложение через `file://`.

## Автосохранение

Изменения сохраняются в IndexedDB через 1,5 секунды после последнего редактирования. Хранятся пять последних версий, включая планы, локальные панорамы, 3D-модель, метаданные и исходный архив. Список восстановления открывается только вручную через **Файл / Сохранить → Автосохранения**; при запуске и перезагрузке страницы окно не создаётся. Восстановление поверх несохранённых изменений требует подтверждения.

Данные привязаны к браузеру и адресу сайта. Очистка данных сайта удалит версии. Автосохранение не заменяет экспорт важных дворцов: при нехватке места или запрете IndexedDB приложение показывает ошибку в окне сохранения. Изменения, сделанные непосредственно перед аварийным закрытием, могут не успеть записаться.

## meta.json

Откройте `.3dview`, `.mpalace` или `.mplace`, затем **Файл / Сохранить → meta.json**. Можно просматривать исходный текст, исправлять повреждённый JSON или создавать отсутствующий файл. Кнопка **Применить** принимает только корректный JSON-объект.

**Скачать исходный архив** создаёт копию открытого архива с изменённым `meta.json`; содержимое остальных файлов сохраняется. Сам файл на диске браузер не перезаписывает. Другие правки дворца в эту копию не входят: для них используйте обычное сохранение `.mpalace`. Экспорт `.mpalace` включает применённый `meta.json`. Чтобы импортёр заново применил служебные поля метаданных к туру, откройте скачанный архив.

## Офлайн

Библиотеки ZIP, PDF, Three.js и английского OCR находятся в `vendor/`. Темы используют системные шрифты. После первого успешного открытия service worker сохраняет весь набор файлов приложения (около 35 МБ); статус кэша виден в окне сохранения. После подготовки кэша доступны локальные дворцы, импорт архивов, 3D-панорамы, PDF и OCR без подключения к сети. Внешние онлайн-туры требуют сеть.

При изменении файлов приложения выполните `npm run update:offline`, чтобы обновить список ресурсов и версию кэша в `sw.js`. Новая версия кэша активируется автоматически; открытый дворец не перезагружается принудительно. Незавершённая загрузка обновления не удаляет предыдущий кэш.

## Проверки

```sh
npm ci
npm test
```

Тестовый runner сам запускает локальный HTTP-сервер на свободном порту и закрывает его после проверок. Используется установленный `/usr/bin/chromium`; если его нет, установите браузер Playwright:

```sh
npx playwright-core install --with-deps chromium
```

Можно указать `CHROMIUM_PATH`. Каждый сценарий использует отдельный браузерный контекст и не затрагивает пользовательские данные. В GitHub Actions проверки запускаются при push и pull request.

Регрессия покрывает:

- скрытие инструментов редактирования без пустых мест и восстановление при переключении режима;
- отсутствие «Планы» в хедере;
- возврат всех локусов после остановки повторения до и после проверки ответа, в режиме редактирования и просмотра;
- навигацию панорам после поворотов, переходов, переключения панелей и изменения размера;
- полное отображение широких, вытянутых и обычных планов в компактной и развёрнутой миникарте, включая крайние камеры и изменение высоты окна;
- быстрый выбор панорам при задержке загрузки Three.js;
- редактирование, создание и валидацию `meta.json`, сохранность остальных файлов исходного архива;
- пять версий автосохранения, восстановление изображений, панорам, 3D-модели и исходного архива;
- повторный запуск без сети, локальные Three.js, PDF-экспорт и OCR.

Основные сценарии выполняются на desktop и в профилях Android, iPhone и iPad. Chromium проверен локально; матрица WebKit настроена в CI. [Подробная матрица покрытия и ограничения](TESTING.md). Это эмуляция браузеров, а не испытания на физических устройствах.

## Переходы камер

Выберите инструмент **Редактирование камеры** и камеру на плане. Нажмите «+» справа сверху на другой камере; существующие связи показаны пунктиром. Контекстное меню **Добавить переход на плане…** и кнопка **Переходы на плане** в настройках 3D открывают этот же редактор. Для удаления перехода нажмите «−» справа сверху на связанной камере; «+» у остальных камер добавляет переход. Связь создаётся и удаляется в обе стороны; правки поддерживают отмену, автосохранение и экспорт `.mpalace`. Все регрессионные тесты находятся в `test/`.

## Модульный режим и аддоны

**Settings → Community plugins**: загрузка своего ZIP/`.palace-addon`, команды, панели, включение/отключение и удаление расширений. Модульный режим можно выключить целиком. [Документация API и пример](ADDONS.md). Это формат PALACE по модели VSCode, без совместимости с `.vsix`.

## Видимость инструментов

**Settings → Interface**: скрытие и восстановление системных и аддонных кнопок, значков, команд и слоёв. Настройки сохраняются в браузере. Аддоны могут размещать инструменты на плане, в 3D, хедере и строке состояния; [API 1.1](ADDONS.md).

В режиме «Редактирование камеры» выберите камеру на плане. Её можно перетащить, назначить начальной либо удалить с подтверждением. Для двустороннего перехода нажмите «+» на второй камере. Переходы показаны линиями и удаляются отдельными кнопками. Ctrl/Cmd+Z восстанавливает удалённую камеру вместе с переходами и ссылками локусов. Автосохранения открываются вручную из окна сохранения; при запуске страницы окно восстановления не появляется.

Управление камерами находится на значках плана: выбранная камера выделена обводкой, корзина справа сверху удаляет её после подтверждения, флаг слева снизу назначает начальной. У остальных камер справа сверху «+» добавляет связь с выбранной, «−» удаляет. Связи отображаются пунктиром; выбранная камера, её соседи и связи выделены. Отдельной панели редактирования нет.

Исходная страница для редактирования — `index.max.html`. `index.html` — минифицированная версия для публикации. После правок выполните `npm run build`: он минифицирует HTML, встроенные CSS/JavaScript и обновляет офлайн-кеш. Порядок подключения внешних скриптов и глобальные имена сохраняются.

Значок редактора камер — камера с карандашом. Кнопки на камерах пропорциональны размеру маркера и масштабируются вместе с планом; зум не пересчитывает их размеры и не изменяет DOM камер.

В разделе **Settings → Community plugins** нажмите **Install plugin**: выбор файла, перетаскивание пакета и подтверждение установки находятся внутри меню. Настройки инструментов поддерживают поиск и фильтры «Системные» / «Аддонные». Флаг камеры всегда жёлтый и расположен слева снизу.

The **Settings** window opens from the sidebar gear. Its vertical navigation groups are **Options**, **Core plugins**, and **Community plugins**, with installed plugins listed separately. Appearance uses grouped rows with descriptions and controls for themes, accent color, icon sets, interface size, and font. Editor controls change marker size, plan background, and wall color. **Files and links** opens file operations, archive metadata, and local snapshots. Interface text, dialogs, tooltips, built-in plugin packages, and error messages are in English; project names and notes keep their original language. Appearance and tool preferences are saved in this browser.

**Установка на телефон (PWA):** откройте **Settings → General**. В Chrome на Android появится кнопка установки, когда браузер подготовит приложение; также доступна установка через меню браузера. На iPhone/iPad откройте сайт в Safari и выберите **Поделиться → На экран «Домой» → Добавить**. Первый запуск выполняется онлайн через HTTPS; после загрузки приложение поддерживает офлайн-работу. Дворец можно перенести в установленное приложение через файл `.mpalace`.

### Plugin management

**Settings → Community plugins → Settings & log** shows permissions, declared plugin settings, and the last 100 activity/error messages from the current session. Plugins can be restarted or updated with **Update from file**. Update confirmation shows the old/new version and any new permissions. Updates retain compatible settings, private storage, and the enabled/disabled preference; incompatible API ranges are rejected before installation. PALACE API is now **1.4.0**, with the existing `apiVersion: 1` package format retained.

### Change history (system addon)

**Settings → Core plugins → Change history** enables or disables the built-in addon. Open **Change history** under the Core plugins navigation group to inspect versions, save a checkpoint, and restore a version after confirmation. History captures committed project edits and Undo/Redo, including floor plans, loci and notes, cameras and transitions, archive metadata/files, and imported model assets. Restoring saves a **Before restoring a version** backup first.

Up to **50 versions per palace** are stored locally in IndexedDB, with shared images and archive bytes stored once. Reopening the same archive keeps its history; exported palace files carry a history identity, not the history itself. The palace selector also exposes saved histories after a reload. Versions stay available when recording is disabled. History does not open automatically and does not replace Undo or autosaves. Clearing browser site data deletes local history; export important palace files separately.
