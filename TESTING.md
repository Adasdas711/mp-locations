# Регрессия PALACE

`npm test` запускает локальный сервер на свободном порту, все сценарии из `test/`, затем закрывает сервер и браузеры. Данные пользователя не используются. Каждый сценарий получает отдельный браузерный контекст. Параллелизм ограничен двумя файлами, чтобы 3D и OCR не перегружали машину.

```sh
npm ci
npm test
```

Для другого движка установите браузер Playwright и укажите его:

```sh
npx playwright-core install --with-deps webkit
PALACE_BROWSER=webkit npm test
```

GitHub Actions запускает матрицу Chromium / WebKit. Настройка workflow не означает, что удалённый запуск прошёл: его результат нужно смотреть отдельно. Локальная загрузка дополнительных браузеров в облачной среде может требовать доступа к `cdn.playwright.dev` и `playwright.download.prss.microsoft.com`.

## Что проверяется

| Область | Проверки | Файлы |
| --- | --- | --- |
| Локусы | Создание, выбор, сдвиг, удаление, отмена/повтор, порядок маршрута, размер | `functional.cjs`, `errors.cjs`, `mobile.cjs` |
| Этажи | Переименование, выбор, перестановка, объединение/разделение, сохранность локусов, размещение и отмена размещения, удаление/отмена удаления | `functional.cjs`, `errors.cjs` |
| Изображения | Импорт, поворот, отражение, яркость, обрезка, создание этажа | `functional.cjs` |
| Файлы | PNG текущего этажа, ZIP всех PNG, PDF, импорт PDF, `.mplace`, `.mpalace`, Zillow/Matterport `.3dview`, вложенный архив, повреждённый файл | `functional.cjs`, `formats-3d.cjs`, `persistence.cjs` |
| Панорамы | Выбор, переходы, стартовая камера, привязка/отвязка локуса, редактор камер (выбор без перехода в 3D, перетаскивание мышью/касанием, связывание на плане, удаление с отменой, стартовая камера), калибровка направлений, быстрая смена при задержанной загрузке | `functional.cjs`, `modes.cjs`, `transitions.cjs` |
| Переходы | Добавление/удаление обоих направлений, отмена, сохранение и повторное открытие, запрет в просмотре | `transitions.cjs` |
| 3D этажей | Настоящий WebGL-рендер, этажи, фото/схема, масштаб, возврат в 2D; восстановление бинарной модели из автосохранения | `formats-3d.cjs`, `persistence.cjs` |
| Миникарта | Три пропорции плана, компактный/развёрнутый режим, крайние камеры, клики, размер окна и ориентация | `minimap.cjs` |
| Повторение | Все пять режимов с контролируемой случайностью, правильные ответы, следующий раунд, выход до/после проверки, восстановление локусов и режима | `functional.cjs`, `modes.cjs` |
| Интерфейс | Скрытие инструментов просмотра, заголовок, увеличение/уменьшение, поворот, фон, цвет стен, тема, размер UI | `functional.cjs`, `modes.cjs` |
| Клавиши | Поиск, переназначение и сброс, отмена/повтор, перемещение и удаление локуса, защита создания нового проекта | `functional.cjs` |
| Автосохранение | Пять версий, восстановление планов, локусов, панорам, 3D-модели, метаданных и исходного архива, подтверждение замены | `persistence.cjs` |
| Метаданные | Неверный JSON, отсутствующий файл, создание, изменение, экспорт, сохранность остальных файлов | `persistence.cjs`, `functional.cjs` |
| Офлайн | Перезагрузка при отключённой сети, локальные ZIP/Three/PDF/OCR; соответствие версии кэша ресурсам | `persistence.cjs`, `static.cjs` |
| Ошибки | Недоступный IndexedDB, экспорт без локального хранилища, повреждённые архивы, неподдерживаемый manifest, ошибка команды аддона | `errors.cjs`, `formats-3d.cjs`, `addons.cjs` |
| Интерфейсы расширений | Собственный SVG-значок, четыре панели инструментов, правки плана/камер, ракурс, слои после перерисовки, сохранение и сброс видимости, отключение, разрешения | `interfaces.cjs` |
| Аддоны | Установка, CommonJS-модули, активация, команды, панели, разрешения, изоляция DOM, включение/отключение, модульный режим, повторный запуск, удаление | `addons.cjs` |
| Мобильный ввод | Настоящие браузерные tap, перетаскивание локусов/панорам, pinch-to-zoom, смена ориентации, доступность сохранения и мобильных действий | `mobile.cjs`, другие сценарии по профилям |

## Мобильная матрица

Основные сценарии выполняются в профилях desktop, Pixel 7 (Android), iPhone 13 и iPad 7. Отдельно миникарта и режимы проверяются в телефонной альбомной ориентации. Это эмуляция UA, viewport, плотности экрана и touch, а не испытания на физических устройствах.

Chromium отправляет многоточечные жесты через CDP `Input.dispatchTouchEvent`. В WebKit у Playwright нет CDP: taps остаются браузерными, а многоточечные последовательности доставляются как PointerEvents. Проверки отдельных операций могут вызывать те же функции, которые использует меню (например, совмещение этажей); это отмечено в коде. API-проверка скрытого мобильного компаса не заменяет ручную проверку жеста поворота на устройстве.

Реальные сетевые туры и произвольные пользовательские архивы не входят в воспроизводимые фикстуры. Провайдеры проверяются управляемыми ответами и нормализацией URL; полноценную интеграцию с авторизованными турами нужно проверять отдельно. Автотесты не доказывают отсутствие всех возможных багов или стопроцентное покрытие каждой ветви.

## Точечный запуск

```sh
PALACE_TEST_FILES=mobile.cjs PALACE_PROFILES=Android npm test
PALACE_TEST_FILES=addons.cjs npm test
```

`PALACE_PROFILES` действует на общую матрицу новых сценариев. Точечный прогон не заменяет общий. После изменения ресурсов приложения выполните `npm run update:offline` перед полным прогоном.

`offline-update.cjs` воспроизводит старый офлайн-кэш с автоматически открывающимся восстановлением: проверяет активацию обновления без закрытия вкладки, удаление старого кэша, закрытое окно после обновления и ручное восстановление сохранённого дворца. `transitions.cjs` проверяет вход в связывание на плане из настроек 3D и контекстного меню; модального редактора переходов больше нет.

`appearance.cjs` проверяет отдельный пакет оформления на desktop/Android/iPhone/iPad: темы и светлый режим, SVG-иконки, импорт JSON и ошибки, восстановление после перезагрузки, отключение/удаление и проверку разрешений.

`extension-operations.cjs` проверяет API 1.3 на desktop/Android/iPhone/iPad: создание камеры, загрузку/замену панорамы, удаление с восстановлением связей, метаданные и бинарные файлы исходного ZIP, скачивание и экспорт проекта, восстановление после перезагрузки, сочетания аддона, конфликт клавиш, фокус ввода, отключение и проверки разрешений.

`camera-ui.cjs` и `camera-actions.cjs` проверяют управление на значках камер на desktop/Android/iPhone/iPad: отсутствие панели, расположение корзины и флага, добавление/удаление связей, назначение начальной камеры, подтверждение удаления и отмену, пунктирный граф, выделение соседей, фильтрацию этажей и движение линий при перетаскивании. Проверяется удаление конуса при выходе из 3D.

`camera-actions.cjs` проверяет удаление конуса после выхода из 3D, переход из панорамы в редактор камеры, немедленное выделение графа, связанные камеры и кнопки +/− на значках, назначение начальной камеры и удаление с подтверждением/отменой на desktop/Android/iPhone/iPad.

`camera-zoom.cjs` проверяет зум на 200 камерах во всех четырёх профилях: 120 изменений масштаба сохраняют кнопки и граф без изменений DOM и стилей камер; «+»/«−» масштабируются вместе с маркерами, сохраняют пропорции при изменении размера маркера; кнопка уменьшения масштаба и выделение камер после зума продолжают работать. `static.cjs` проверяет соответствие минифицированного `index.html` исходнику `index.max.html` и синтаксис встроенных скриптов обеих версий.

Проверки навигации дополнительно проверяют сохранение графического слоя после зума, объединённое перемещение двумя пальцами за одну запись трансформации и перетаскивание плана без пересоздания камер и связей. У выбранной начальной камеры проверяется единственный видимый флаг; старые индикаторы не создаются в режиме редактирования камер.

`addon-menu.cjs` проверяет встроенную установку аддона, отмену загрузки, отсутствие дополнительного модального окна, адаптивную компоновку и фильтры инструментов на desktop/Android/iPhone/iPad.

Регрессия флага проверяет вход в редактор без перерисовки плана: старый индикатор на связанной начальной камере удаляется, «−» не перекрывается, единственный жёлтый флаг остаётся слева снизу. В обычном просмотре индикатор тоже расположен слева снизу.

`settings.cjs` проверяет единое окно настроек, отсутствие кнопок аддонов/загрузки планов в боковой панели, разделы, тему, размер интерфейса, поиск, клавиатурную навигацию, горячие клавиши открытия и закрытие на desktop/Android/iPhone/iPad. Тесты аддонов используют новый путь «Settings → Community plugins».

`pwa.cjs` проверяет инструкции для Android/iOS, обработку доступного браузерного приглашения, отмену/принятие установки, событие `appinstalled`, сохранность открытого дворца и согласованность манифеста, размеров иконок и офлайн-кеша. Браузерное приглашение в тестах моделируется; установка на физический телефон требует действия пользователя. `camera-actions.cjs` дополнительно проверяет одинаковый размер камер при входе в редактор и после выбора другой камеры, отсутствие старого выделения `.active` в редакторе и его восстановление при возврате к просмотру.

`settings-layout.cjs` covers the grouped settings tree and English interface on desktop, Android, iPhone and iPad. It checks appearance persistence across reloads and theme changes, accent reset, marker size and floor background controls, built-in tool toggles, viewport bounds, dynamic installed-plugin navigation, and preservation of Russian project names and notes. Existing regression assertions now use English UI labels without changing the underlying feature checks.

`addon-management.cjs` covers plugin settings and notifications, error logging, API compatibility, update permission previews, settings/storage preservation, disabled updates, reload persistence, and failed-storage safety. `history-addon.cjs` covers the system addon lifecycle, version browsing, cancelled/confirmed restoration, camera links and metadata, pre-restore backups, persistence after reload, shared archive assets, 50-version retention and orphan cleanup, invalid imports, reserved-key/typed-array round trips, and protection in view mode. Both workflows run on desktop, Android, iPhone and iPad; storage and validation guards have dedicated additional cases.

`workspace-system-addons.cjs` checks both native system addons across desktop, Android, iPhone and iPad: palette search and no-results state, keyboard navigation, native/plugin command execution, shortcut rebinding, disable/enable lifecycle, preset save/apply/rename/delete, JSON export/import, reload persistence, malformed-file rejection, and preservation of palace content during workspace changes.

`plugin-action-menu.cjs` verifies system-addon gears, unchanged toggle state, community overflow-menu visibility, keyboard opening, Escape/focus return, outside-click closing, settings access, removal, and viewport bounds on desktop, Android, iPhone and iPad. Existing plugin-management tests now open actions through the overflow menu.

`visual-controls.cjs` checks themed file-selector buttons and matching typography, native file chooser behavior, styled history selectors, shared styles in isolated plugin panels, dark/light theme updates, and persisted hosts after reload on desktop, Android, iPhone and iPad. The visual audit also covers the settings sections and export dialog for viewport bounds and horizontal overflow.

`audit-regression.cjs` covers bugs reproduced in the comprehensive audit: palette shortcuts during text entry and metadata editing, shortcut ownership after re-enabling a system addon, failed plugin writes, concurrent settings/storage RPCs from an isolated plugin host and persistence after reload, retrying a failed 3D engine download, and cancelling pending plan additions/merges when another palace opens. These cases run on desktop, Android, iPhone and iPad; shortcut ownership also has a dedicated case.

Plugin reload tests allow service workers. Playwright's `serviceWorkers: 'block'` injects a script that reads `navigator.serviceWorker` in every frame, which throws in opaque sandboxed plugin frames. The production sandbox keeps `allow-same-origin` disabled; tests continue asserting that the application has no uncaught JavaScript errors.
