#!/usr/bin/env python3
"""
3D Tour Grabber
=====================================================================

Оба поддерживаемых сайта — Zillow (media-experiences-subapp) и
Matterport (my.matterport.com) — сами держат ПОЛНЫЕ данные тура в
памяти вкладки после её загрузки. Кликать по синим точкам не нужно
вообще ни для одной из платформ.

Эта программа САМА определяет, какая это платформа (проверяет оба
сигнала сразу в каждом фрейме страницы — window.__NEXT_DATA__ для
Zillow и window.MP_PREFETCHED_MODELDATA для Matterport) и запускает
нужную ветку извлечения:

  Zillow  → window.__NEXT_DATA__ → richMedia: panos[] (прямая ссылка
            на 8k-фото), panoLoc.world[] (координаты), visualizations[]
            (готовая картинка плана + bounds/scale для перевода
            координат в пиксели плана), floors[], rooms[]. На практике
            у БОЛЬШИНСТВА туров (более старый/простой формат без полной
            3D-модели) нет ни panoLoc.world, ни visualizations вовсе.
            В этом случае сначала берётся план с карточки объявления
            (вкладка «Floor plan» — SVG floor_map с zillowstatic или
            загруженное фото), см. find_zillow_listing_floor_plan_urls();
            если и его нет — строится приближённая схема по графу
            углов переходов (departureAngle), см. _draw_zillow_angle_schematic()
            ("_hypothesis" в имени файла), а не точный план, потому что
            реальных расстояний между точками Zillow в этом формате не
            отдаёт вообще, только относительные углы.

  Matterport → window.MP_PREFETCHED_MODELDATA.queries:
            GetModelPrefetch.data.model.locations[] (точки съёмки:
            комната, этаж, мировые координаты, соседи, и pano.skyboxes[]
            — прямые ссылки на 6 JPG-граней куба панорамы без тайлов),
            GetRootPrefetch.data.model (этажи, комнаты, название,
            адрес), GetRoomClassifications (справочник категорий).
            Официальной картинки плана у Matterport нет — она рисуется
            на лету из 3D-модели; программа сохраняет саму 3D-модель
            (assets.meshes[] — файл .dam) в архив, а пока план — схема по
            мировым координатам точек. Для каждой точки 6 граней куба
            склеиваются в круговую панораму *_equirect.avif; раскладка
            граней проверена по стыкам на реальном туре (раунд 69):
            face0 = верх, face1..4 = стороны по кругу вправо, face5 = низ.
            Грани и панорамы сохраняются в AVIF (≈ вдвое меньше JPG).

Результат работы — всегда одна и та же структура архива независимо от
платформы: links.json/mapping.json/meta.json + фото + план, всё внутри
arhive/, затем одним файлом в tour.3dview (обычный zip с другим
расширением), после чего сама папка arhive/ удаляется — всё нужное
остаётся только внутри архива.

Формат Zillow "showcase" (richMedia из GraphQL-ответа: есть panos[],
НЕТ panoLoc.world/visualizations и НЕТ растрового плана — ни hero.png,
ни compressed.svg на карточке): план и координаты камер берутся из САМОГО
richMedia + официального SVG плана этажа (floors[].primarySvgSource,
публичный CDN): id групп <g class="note"> в SVG = floorMapRoomId из
allPanosToRooms/rooms[], позиция камеры = центр её комнаты (точность
0.3-1.0 м), бескомнатные — интерполяция по соседям; точные координаты —
из перехваченного vrmodels/imx_<rev>.json, если 3D-просмотрщик успел его
загрузить. SVG вшивкой width/height по viewBox растеризуется в PNG без
letterbox, метры → пиксели напрямую. См. _apply_showcase_floor_plan_
positions(). Источник НЕ зависит от DOM панели Floor Plan (та в живом
прогоне 2026-09-20 не успела отрендериться; оставлен как резерв, см.
_capture_interactive_floorplan_panel()).

На вход годится как прямая ссылка на тур, так и обычная ссылка на
объявление на Zillow (.../homedetails/.../<zpid>_zpid/). На карточке
объявления данные тура заранее не загружены — они появляются на
странице только после того, как открыть тур, поэтому программа сама
ищет там кнопку/плашку «3D Tour» (или готовую ссылку на тур прямо в
данных страницы) и открывает её, а уже потом действует как обычно.

Ссылки можно обрабатывать не по одной, а очередью: они добавляются в
список прямо в окне программы (можно вставить сразу несколько через
пробел/запятую/новую строку), список показывает статус каждой ссылки,
а «Старт» скачивает всё по очереди подряд в одном и том же окне Chrome
— новые ссылки можно дописывать даже пока идёт обработка.

Все файлы одного тура (план + все панорамы/грани) скачиваются пулом
потоков, а не по одному — это основная причина, почему на турах с
большим числом панорам загрузка идёт быстро. Если часть файлов не
скачалась с первого раза (сетевая ошибка, таймаут и т.п.), неудачные
загрузки автоматически повторяются ещё несколько раз в конце первого
прохода — вручную ничего перезапускать не нужно.

После того как вся очередь обработана (успешно или с ошибками), Chrome
закрывается сам — как через CDP (Browser.close), так и принудительным
завершением процесса, если это программа его запускала.

Имя файла результата (.3dview) задаётся прямо в окне программы шаблоном,
который обрабатывается как настоящая f-строка Python (то есть работают
любые выражения и спецификаторы формата внутри {...}, например
{fl_count:02d}, а не только простая подстановка str.format()). Шаблон по
умолчанию — DEFAULT_NAME_TEMPLATE ниже. Доступные в шаблоне переменные
собираются в _build_name_context() и включают, среди прочего, число
этажей/комнат/панорам, платформу, адрес объекта (если удалось найти),
название модели, ZPID (для Zillow), исходную ссылку и дату/время.
"""

import concurrent.futures
import glob
import json
import math
import os
import platform as platform_mod
import re
import shutil
import ssl
import subprocess
import threading
import time
import tkinter as tk
import urllib.request
import zipfile
from datetime import datetime
from html import unescape as html_unescape
from tkinter import filedialog, messagebox, scrolledtext, ttk

from playwright.sync_api import sync_playwright

# Раунд 65: «сторожевой» модуль времени. Форма «Press & Hold» может выскочить
# в ЛЮБОЙ момент обработки (не только при первой загрузке) — поэтому каждая
# пауза рабочего потока (time.sleep) заодно даёт шанс проверить страницу.
# Время, проведённое в ожидании человека, вычитается из time.time()/monotonic(),
# чтобы оно не «съедало» таймауты шагов, внутри которых случилась пауза.
_REAL_TIME = time


class _GuardedTime:
    def __init__(self, real):
        self._t = real
        self.paused_total = 0.0
        self.hook = None

    def __getattr__(self, name):
        return getattr(self._t, name)

    def time(self):
        return self._t.time() - self.paused_total

    def monotonic(self):
        return self._t.monotonic() - self.paused_total

    def sleep(self, secs):
        self._t.sleep(secs)
        h = self.hook
        if h is not None:
            try:
                h()
            except Exception:
                pass


time = _GuardedTime(_REAL_TIME)

# Сторож внутри страницы: ставится во все новые документы (add_init_script)
# ДО скриптов сайта, поэтому подмены встроенных функций на странице проверки
# на него не действуют. Раз в секунду смотрит, видна ли форма, и сообщает
# граббертy через binding.
PX_WATCH_INIT_JS = r"""
(() => {
  try {
    if (window.__grabberPxWatch) return;
    window.__grabberPxWatch = 1;
    /* раунд 74: ссылки на встроенные функции берём ДО скриптов страницы
       (страница проверки их подменяет); проверяем не только обёртку формы,
       но и сам #px-captcha, iframe «Human verification», заголовок вкладки
       и текст формы; реагируем сразу на изменения DOM, а не раз в секунду */
    const qs = Document.prototype.querySelector;
    const gbr = Element.prototype.getBoundingClientRect;
    const gcs = window.getComputedStyle;
    const MO = window.MutationObserver;
    const SEL = '#px-captcha-wrapper, .px-captcha-container, #px-captcha, iframe[title*="Human verification" i], [class*="px-captcha"]';
    const TITLE_RX = /access to this page has been denied|press\s*(&|and)\s*hold|human verification|verify you are (a )?human|are you a (human|robot)/i;
    let last = 0, pending = 0;
    const visible = el => {
      try {
        const r = gbr.call(el);
        if (r.width < 30 || r.height < 20) return false;
        const cs = gcs(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05;
      } catch (e) { return false; }
    };
    const report = () => {
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      if (typeof window.__grabberPxSeen === 'function') window.__grabberPxSeen(location.href);
    };
    const tick = () => {
      pending = 0;
      try {
        const el = qs.call(document, SEL);
        if (el && visible(el)) { report(); return; }
        if (TITLE_RX.test(document.title || '') && qs.call(document, SEL)) { report(); return; }
      } catch (e) {}
    };
    setInterval(tick, 1000);
    const arm = () => {
      try {
        if (!MO || !document.documentElement) return;
        new MO(() => { if (!pending) pending = setTimeout(tick, 250); })
          .observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {}
    };
    if (document.documentElement) arm(); else document.addEventListener('DOMContentLoaded', arm);
  } catch (e) {}
})();
"""
# Раунд 74: быстрые признаки формы «Press & Hold» (по всем фреймам, изолированный
# мир Playwright). Дорогая полная проверка (_human_check_state) запускается только
# если что-то из этого сработало — раньше она гонялась каждые полсекунды.
PX_QUICK_SELECTOR = ('#px-captcha-wrapper, .px-captcha-container, #px-captcha, '
                     'iframe[title*="Human verification" i], [class*="px-captcha"]')
PX_TITLE_RX = re.compile(r"access to this page has been denied|press\s*(&|and)\s*hold|human verification|"
                         r"verify you are (a )?human|are you a (human|robot)", re.I)
PX_GUARD_INTERVAL_SEC = 2.5

ARCHIVE_DIR = "arhive"
DEBUG_LOG_PATH = os.path.join(ARCHIVE_DIR, "debug_log.txt")
MAPPING_PATH = os.path.join(ARCHIVE_DIR, "mapping.json")
LINKS_PATH = os.path.join(ARCHIVE_DIR, "links.json")
META_PATH = os.path.join(ARCHIVE_DIR, "meta.json")
RAW_DATA_PATH = os.path.join(ARCHIVE_DIR, "raw_data.json")
OUTPUT_EXT = ".3dview"
OUTPUT_BASENAME = "tour" + OUTPUT_EXT  # обычный zip, только с этим расширением

# Версия сборки — пишется в первую строку debug_log.txt и в meta.json,
# чтобы сразу видеть по логу, какая версия grabber.py реально запускалась
# (раунд 15, урок: дважды прогнали старый файл, не заметив этого).
GRABBER_VERSION = ("15.55 / раунд 74: в архив для PALACE — копия плана без номеров камер (plan.clean.png) и готовые подписи комнат в пикселях плана (meta.json → palace); фото/планы в архиве без повторного сжатия (быстрее запись и открытие); проверка «Press & Hold» — быстрые признаки по всем фреймам (разметка PerimeterX, заголовок вкладки, ответы 403/429), сторож в странице реагирует на изменения DOM сразу, дорогая полная проверка — только при подозрении; меньше слепых пауз в шаге эталонных скриншотов; раунд 73: план Matterport в стиле Zillow — прозрачный фон, ровные стены (притянуты к осям помещения, куски слиты, углы сомкнуты), мебель отсекается срезами на разных высотах, сглаженная площадь этажа с контуром; прозрачность планов сохраняется при нанесении камер; раунд 72: ссылки Matterport любого вида — discover.matterport.com/space/ID (и /de/space/…), my.matterport.com/show?play=1&m=ID, iframe тура на чужой странице — приводятся к my.matterport.com/show/?m=ID; «Из файла…» читает и сохранённые страницы (.mhtml/.html): со страницы тура — только её тур, со страницы подборки/поиска — все туры; раунд 71: Matterport — поворот каждой панорамы (extra.panoYawDeg из pano.rotation, проверен по 3D-модели) для редактора PALACE; раунд 70: Matterport — настоящий 2D-план из 3D-модели (срез стен на высоте ~1.1 м, пол, контур, масштаб 1 м), камеры на плане по реальным координатам, неразмещённые фото (upload) не рисуются; без AVIF грани больше не пережимаются (архив не растёт); раунд 69: Matterport — правильная склейка панорам (раскладка граней проверена по стыкам на реальном туре), фото в AVIF, 3D-модель .dam в архив, точки без этажа — на ближайший этаж; раунд 68: комнаты по плану — копии одного этажа (план карточки и план тура с разными id) больше не складываются; раунд 67 / раунд 67: шаблон имени по умолчанию — комнаты - площадь - панорамы - этажи; раунд 66 / раунд 66: число комнат = комнаты, подписанные на плане этажа (SVG Zillow, помещения с размерами), вместо типов панорам / разделов фотоальбома; раунд 65 / раунд 65: постоянный контроль формы «Press & Hold» на протяжении всей обработки (сторож в странице + проверка на каждой паузе/логе рабочего потока), время паузы не съедает таймауты шагов; раунд 64 / раунд 64: форма «Press & Hold» определяется по её настоящей разметке (#px-captcha-wrapper / .px-captcha-container, .px-captcha-message, .px-captcha-refid, iframe «Human verification challenge»); раунд 63 / раунд 63: форма «Press & Hold» ищется локаторами Playwright в изолированном мире (страница проверки подменяет встроенные функции JS, из-за чего прежний поиск падал), с проходом в Shadow DOM, плюс дерево доступности браузера (CDP) для закрытого Shadow DOM; раунд 62 / раунд 62: загрузка ссылок из текстового файла (кнопка «Из файла…»); детект именно формы «Press & Hold» (и целая страница, и всплывающее окно «Before we continue…» поверх сайта), по всем фреймам, только видимые элементы; раунд 61 / раунд 61: ложное срабатывание «Press & Hold» на обычной карточке (фоновый iframe px-cloud / reCAPTCHA) — детект только по видимой заглушке; раунд 60 / раунд 60: площадь участка в шаблоне имени ({lot_sqft}, {lot_m2}), м² в шаблоне по умолчанию; раунд 59 / раунд 59: детект проверки «Press & Hold» (PerimeterX) при загрузке — пауза до ручного прохождения; раунд 58 / раунд 58: подпись тумблера «…на PNG-планах», окно прозрачнее (92%/78%); раунд 57: тёмная/светлая тема (как в macOS, выбор запоминается), лёгкая прозрачность окна, понятная подпись тумблера скрытых камер; баги: пустое место после «Скрыть» у переменных, счётчик очереди после удаления")
GRABBER_VERSION_SHORT = "15.55"

# Шаблон имени файла результата по умолчанию — можно поменять прямо в окне
# программы. Обрабатывается как f-строка Python (см. render_name_template):
# fl_count/r_count/p_count — число этажей/комнат/панорам.
DEFAULT_NAME_TEMPLATE = "{r_count}rooms - {lot_m2}m2 - {p_count}panoramas - {fl_count}floors"
# прежний шаблон по умолчанию — если он сохранён в настройках, обновляем на новый
OLD_DEFAULT_NAME_TEMPLATES = ("{fl_count}floors - {r_count}rooms - {p_count}panoramas",
                              "{fl_count}floors - {r_count}rooms - {p_count}panoramas - {lot_m2}m2")
SQFT_TO_M2 = 0.09290304
ACRE_TO_SQFT = 43560.0

CDP_URL = "http://127.0.0.1:9222"
CDP_PORT = 9222
CHROME_MAC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
USER_DATA_DIR = os.path.expanduser("~/chrome-photo-grabber")
DETECT_WAIT_SEC = 25.0
# Проверка «Press & Hold» (PerimeterX / HUMAN) на Zillow: сколько ждать,
# пока человек пройдёт её вручную, и как часто проверять.
HUMAN_CHECK_MAX_WAIT_SEC = 20 * 60
# Раунд 63: части формы «Press & Hold» для поиска локаторами Playwright.
# Локаторы работают в ИЗОЛИРОВАННОМ мире (страница проверки PerimeterX
# подменяет Array.from / итераторы и т.п. — обычный page.evaluate на ней
# падает), видят Shadow DOM и сами проверяют видимость.
HUMAN_FORM_PARTS = (
    ("head", re.compile(r"press\s*(&|and)\s*hold\s+to\s+confirm\s+you\s+are", re.I)),
    ("btn", re.compile(r"^\s*press\s*(&|and)\s*hold\s*$", re.I)),
    ("ref", re.compile(r"reference\s+id\s*[0-9a-f]{6}", re.I)),
    ("before", re.compile(r"before\s+we\s+continue", re.I)),
)
HUMAN_CHECK_POLL_SEC = 1.0
HUMAN_CHECK_JS = r"""
() => {
  /* Раунд 62: ищем саму ФОРМУ проверки, в любом её виде:
       • целая страница (белая карточка по центру, фон любой);
       • всплывающее окно «Before we continue…» поверх обычного сайта.
     Признаки формы (учитываются только ВИДИМЫЕ элементы):
       head   — текст «Press & Hold to confirm you are a human»;
       btn    — отдельная кнопка/блок с текстом ровно «Press & Hold»
                или видимый контейнер #px-captcha;
       ref    — строка «Reference ID …»;
       before — заголовок «Before we continue…».
     Вызывается в КАЖДОМ фрейме: кнопка PerimeterX может жить в своём iframe. */
  const out = { head: false, btn: false, ref: false, before: false, px: false, title: document.title || '', url: location.href };
  try {
    const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
    const visible = el => {
      for (let e = el, i = 0; e && e.nodeType === 1 && i < 40; e = e.parentElement, i++) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return false;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return false;
      return true;
    };
    const norm = t => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let n, count = 0;
    while ((n = walker.nextNode()) && count < 20000) {
      count++;
      const raw = n.nodeValue;
      if (!raw || raw.length < 4) continue;
      const t = norm(raw);
      if (!/hold|human|reference id|before we continue/.test(t)) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const full = norm(el.innerText || el.textContent);
      if (!visible(el)) continue;
      if (/press\s*(&|and)\s*hold to confirm/.test(full) || /confirm you are\s+a\s+human/.test(full)) out.head = true;
      if (/^press\s*(&|and)\s*hold$/.test(full)) out.btn = true;
      if (/^reference id\b/.test(full) || /\breference id [0-9a-f-]{8,}/.test(full)) out.ref = true;
      if (/^before we continue/.test(full)) out.before = true;
    }
    const pxb = document.querySelector('#px-captcha');
    if (pxb && visible(pxb)) { out.px = true; }
  } catch (e) { out.err = String(e); }
  return out;
}
"""
POLL_INTERVAL = 0.5

# Параллельная загрузка: сколько файлов качаем одновременно и сколько раз
# автоматически повторяем те, что не скачались с первого раза.
MAX_WORKERS = 16  # раунд 53: было 8 — загрузка упирается в задержки сети, а не в канал
DOWNLOAD_RETRIES = 2
RETRY_DELAY_SEC = 2.5

SSL_CTX = ssl._create_unverified_context()

RESOLUTION_RANK = {"4k": 4, "2k": 3, "high": 2, "low": 1}

# ---------- палитра / шрифты ----------
# Раунд 55: палитра macOS (светлая тема Big Sur+): системный синий,
# нейтральные серые, белые карточки на светло-сером фоне.
BG = "#eceef3"
PANEL = "#ffffff"
BORDER = "#e3e3e8"
TEXT = "#1d1d1f"
MUTED = "#86868b"
FIELD_BG = "#ffffff"
BTN_BG = "#eef0f4"
BTN_HOVER = "#e2e2e7"
BTN_PRESSED = "#d6d6dc"
ACCENT = "#007aff"
ACCENT_HOVER = "#1a86ff"
ACCENT_DARK = "#0062cc"
ACCENT_DISABLED = "#99c7ff"
ACCENT_TEXT = "#ffffff"
SELECT_BG = "#dcebff"
GLASS = "#fbfbfd"          # тело стеклянной карточки
GLASS_EDGE = "#dfe1e8"     # тонкая кромка
GLASS_INSET = "#f2f3f7"    # вложенное стекло (блок переменных)
TRACK_OFF = "#d9d9de"      # выключенный переключатель
TRACK = "#e5e5ea"
OK_COLOR = "#28a745"
ERR_COLOR = "#ff3b30"
LOG_BG = "#1c1c1e"
LOG_BORDER = "#2c2c2e"
LOG_FG = "#e5e5ea"
_IS_MAC = platform_mod.system() == "Darwin"

# Раунд 57: две темы. Значения подставляются в глобальные цвета выше
# (_apply_theme_globals), виджеты читают их при каждой перерисовке.
THEMES = {
    "light": dict(
        BG="#eceef3", PANEL="#ffffff", BORDER="#e3e3e8", TEXT="#1d1d1f", MUTED="#86868b",
        FIELD_BG="#ffffff", BTN_BG="#eef0f4", BTN_HOVER="#e2e2e7", BTN_PRESSED="#d6d6dc",
        ACCENT="#007aff", ACCENT_HOVER="#1a86ff", ACCENT_DARK="#0062cc", ACCENT_DISABLED="#99c7ff",
        SELECT_BG="#dcebff", TRACK="#e5e5ea", TRACK_OFF="#d9d9de",
        GLASS="#fbfbfd", GLASS_EDGE="#dfe1e8", GLASS_INSET="#f2f3f7",
        LOG_BG="#1c1c1e", LOG_BORDER="#2c2c2e", LOG_FG="#e5e5ea",
        OK_COLOR="#28a745", ERR_COLOR="#ff3b30",
    ),
    "dark": dict(
        BG="#161618", PANEL="#232326", BORDER="#3a3a40", TEXT="#f5f5f7", MUTED="#98989f",
        FIELD_BG="#1c1c1f", BTN_BG="#2f2f34", BTN_HOVER="#39393f", BTN_PRESSED="#45454b",
        ACCENT="#0a84ff", ACCENT_HOVER="#2b95ff", ACCENT_DARK="#0070e0", ACCENT_DISABLED="#2a4a73",
        SELECT_BG="#1d3a66", TRACK="#3a3a3f", TRACK_OFF="#4a4a50",
        GLASS="#232326", GLASS_EDGE="#38383e", GLASS_INSET="#2b2b2f",
        LOG_BG="#0e0e10", LOG_BORDER="#2a2a2e", LOG_FG="#e5e5ea",
        OK_COLOR="#30d158", ERR_COLOR="#ff453a",
    ),
}
THEME_DARK = False
SETTINGS_PATH = os.path.join(os.path.expanduser("~"), ".3d_tour_grabber.json")


def _load_settings():
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _save_settings(upd):
    try:
        cur = _load_settings()
        cur.update(upd)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _system_prefers_dark():
    """macOS: `defaults read -g AppleInterfaceStyle` → «Dark» в тёмной теме."""
    if not _IS_MAC:
        return False
    try:
        out = subprocess.run(["defaults", "read", "-g", "AppleInterfaceStyle"],
                             capture_output=True, text=True, timeout=2).stdout
        return "dark" in (out or "").lower()
    except Exception:
        return False


def _apply_theme_globals(dark):
    global THEME_DARK
    THEME_DARK = bool(dark)
    globals().update(THEMES["dark" if dark else "light"])
# «.AppleSystemUIFont» — системный шрифт macOS (SF Pro) так, как его видит Tk
FONT_UI = (".AppleSystemUIFont", 13) if _IS_MAC else ("Segoe UI", 10)
FONT_TITLE = (".AppleSystemUIFont", 24, "bold") if _IS_MAC else ("Segoe UI", 17, "bold")
FONT_MONO = ("SF Mono", 11) if _IS_MAC else ("Consolas", 10)
FONT_SMALL = (".AppleSystemUIFont", 12) if _IS_MAC else ("Segoe UI", 9)
FONT_MONO_UI = ("SF Mono", 12) if _IS_MAC else ("Consolas", 10)

ROOM_COLORS = [
    (230, 57, 70), (29, 53, 87), (42, 157, 143), (233, 196, 106),
    (244, 162, 97), (142, 68, 173), (39, 174, 96), (211, 84, 0),
    (41, 128, 185), (192, 57, 43), (22, 160, 133), (127, 140, 141),
]

# Проверяем оба сигнала сразу в каждом фрейме — так платформа
# определяется сама, без догадок по URL (тур может быть встроен в
# сторонний сайт через iframe).
DETECT_EXTRACT_JS = r"""
() => {
  return {
    url: location.href,
    nextData: window.__NEXT_DATA__ || null,
    mpPrefetchedModelData: window.MP_PREFETCHED_MODELDATA || null,
  };
}
"""

# Обычная ссылка на объявление (.../homedetails/.../<zpid>_zpid/) не
# содержит данных тура заранее — они подгружаются на странице только
# после открытия тура. Ниже — то, чем программа сама находит и открывает
# тур на такой странице, если ссылка ведёт не прямо в тур, а на карточку
# объявления (см. _find_and_enter_zillow_tour).

# Полная ссылка на тур иногда уже присутствует где-то в разметке/данных
# страницы объявления (обычная <a href>, либо поле вроде tourUrl в
# встроенном JSON) — тогда проще сразу перейти по ней, чем нажимать
# на кнопку в интерфейсе.
ZILLOW_TOUR_URL_PATTERNS = [
    re.compile(r'https?://[^"\'\s<>]*view-imx[^"\'\s<>]*', re.I),
    re.compile(r'https?://[^"\'\s<>]*my\.matterport\.com/show[/?][^"\'\s<>]*', re.I),
    re.compile(r'https?://[^"\'\s<>]*view-3d-home[^"\'\s<>]*', re.I),
    re.compile(r'"(?:tourUrl|virtualTourUrl|tour3dUrl|matterportUrl|threeDTourUrl)"\s*:\s*"((?:[^"\\]|\\.)*)"', re.I),
]

# Если готовой ссылки на странице нет — ищем саму кнопку/плашку «3D Tour»
# (или «Virtual Tour») и нажимаем её, чтобы тур подгрузился на месте.
ZILLOW_TOUR_TRIGGER_SELECTORS = [
    'a[href*="view-imx"]',
    'a[href*="matterport.com"]',
    'iframe[src*="matterport.com/show"]',
    '[data-testid*="tour-cta" i]',
    '[data-testid*="3d-tour" i]',
    '[data-testid*="virtual-tour" i]',
    'a[aria-label*="3D tour" i]',
    'button[aria-label*="3D tour" i]',
    'a[aria-label*="virtual tour" i]',
    'button[aria-label*="virtual tour" i]',
    'a:has-text("3D Tour")',
    'button:has-text("3D Tour")',
    'a:has-text("Virtual Tour")',
    'button:has-text("Virtual Tour")',
]


def find_zillow_tour_url(html):
    """Ищет в HTML/встроенных данных страницы уже готовую прямую ссылку
    на 3D-тур — либо обычный href (view-imx, my.matterport.com), либо
    значение одного из типичных JSON-полей во встроенных данных страницы
    (tourUrl, virtualTourUrl и т.п.). Возвращает None, если ничего
    похожего не нашлось."""
    if not html:
        return None
    for pat in ZILLOW_TOUR_URL_PATTERNS:
        m = pat.search(html)
        if not m:
            continue
        url = m.group(1) if m.groups() else m.group(0)
        # В HTML-разметке (href="...") амперсанды в query string почти
        # всегда закодированы как &amp; — если не раскодировать, ссылка
        # вида ...?setAttribution=mls&amp;wl=true&amp;initialViewType=pano
        # уйдёт в page.goto() буквально с "&amp;" внутри, и до сервера
        # долетит один параметр setAttribution=mls да мусорные
        # amp;wl/amp;initialViewType/amp;utm_source — часть значений
        # (например initialViewType=pano/floorplan) будет потеряна.
        url = html_unescape(url.replace("\\/", "/")).strip()
        if url.startswith("http"):
            return normalize_tour_url(url)
    return None


# ---------------------------------------------------------------------
# Раунд 72: ссылки Matterport любого вида → канонический адрес тура
# ---------------------------------------------------------------------
# ID модели Matterport — 11 символов [A-Za-z0-9]. Встречается как:
#   https://discover.matterport.com/space/ID      (страница тура в каталоге Discover)
#   https://discover.matterport.com/de/space/ID   (то же, другой язык)
#   https://my.matterport.com/show?play=1&lang=en-US&m=ID   (iframe на странице Discover / сайтах)
#   https://my.matterport.com/show/?m=ID , matterport.com/discover/space/ID
MP_ID_RE = r"[A-Za-z0-9]{11}"
_MP_HOST_RE = re.compile(r"^https?://(?:[a-z0-9-]+\.)*matterport\.com(?:[/?#]|$)", re.I)
_MP_SPACE_RE = re.compile(r"/space/(" + MP_ID_RE + r")(?![A-Za-z0-9])")
_MP_M_PARAM_RE = re.compile(r"[?&](?:amp;)?m=(" + MP_ID_RE + r")(?![A-Za-z0-9])")


def matterport_model_id(url):
    """ID модели из любой ссылки *.matterport.com (или None)."""
    if not url:
        return None
    u = html_unescape(str(url).strip())
    if not _MP_HOST_RE.match(u):
        return None
    m = _MP_M_PARAM_RE.search(u) or _MP_SPACE_RE.search(u)
    return m.group(1) if m else None


def matterport_show_url(model_id):
    return f"https://my.matterport.com/show/?m={model_id}"


def normalize_tour_url(url):
    """Ссылки Matterport любого вида → https://my.matterport.com/show/?m=ID
    (там лежат данные тура MP_PREFETCHED_MODELDATA). Остальные — как есть."""
    mid = matterport_model_id(url)
    return matterport_show_url(mid) if mid else url


def _page_text_from_saved_file(raw_text):
    """Сохранённая страница: .mhtml (MIME, quoted-printable) → (адрес страницы, html всех частей);
    обычный .html → (None, текст)."""
    head = raw_text[:4000]
    if "MIME-Version" in head and "multipart/related" in head:
        try:
            import email
            from email import policy
            msg = email.message_from_string(raw_text, policy=policy.default)
            page_url = msg.get("Snapshot-Content-Location")
            chunks = []
            for part in msg.walk():
                if part.get_content_type() == "text/html":
                    loc = part.get("Content-Location") or ""
                    chunks.append(f"<!-- part: {loc} -->\n" + str(part.get_content()))
            return page_url, "\n".join(chunks)
        except Exception:
            import quopri
            try:
                return None, quopri.decodestring(raw_text.encode("utf-8", "ignore")).decode("utf-8", "ignore")
            except Exception:
                return None, raw_text
    m = re.search(r"<!--\s*saved from url=\(\d+\)(\S+)\s*-->", head)
    if not m:
        m = re.search(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)', raw_text[:200000], re.I)
    return (m.group(1) if m else None), raw_text


def extract_tour_links_from_saved_page(raw_text):
    """Ссылки на туры со СОХРАНЁННОЙ страницы (.mhtml / .html).
    • Страница одного тура (discover…/space/ID или сайт с одним iframe Matterport) → только этот тур
      (блок «похожие туры» внизу страницы не берём).
    • Страница подборки / поиска / аккаунта Discover → все туры на ней.
    • Zillow: карточки объявлений (homedetails …_zpid) и прямые ссылки view-imx.
    → (список ссылок, пояснение)"""
    page_url, html = _page_text_from_saved_file(raw_text)
    html_u = html_unescape(html)
    main_id = matterport_model_id(page_url) if page_url else None
    if main_id:
        return [matterport_show_url(main_id)], f"страница тура Matterport {main_id}"
    # iframe тура на чужом сайте
    iframe_ids = []
    for m in re.finditer(r'<iframe[^>]+src=["\']([^"\']*matterport\.com/show[^"\']*)', html_u, re.I):
        mid = matterport_model_id(m.group(1))
        if mid and mid not in iframe_ids:
            iframe_ids.append(mid)
    # в .mhtml src iframe заменён на cid:, но сама часть-фрейм подписана Content-Location
    for m in re.finditer(r"<!-- part: (\S+) -->", html):
        mid = matterport_model_id(m.group(1))
        if mid and mid not in iframe_ids:
            iframe_ids.append(mid)
    if iframe_ids and not _MP_SPACE_RE.search(page_url or ""):
        is_listing = bool(page_url and re.search(r"discover\.matterport\.com/(?!.*?/space/)", page_url, re.I))
        if not is_listing:
            return [matterport_show_url(i) for i in iframe_ids], "тур(ы) во встроенном окне страницы"
    ids = []
    for m in re.finditer(r"https?://[^\s\"'<>]*matterport\.com/[^\s\"'<>]*", html_u, re.I):
        u = m.group(0)
        if re.search(r"cdn[-.\w]*matterport\.com|/apifs/|/images/", u, re.I):
            continue
        mid = matterport_model_id(u)
        if mid and mid not in ids:
            ids.append(mid)
    for m in re.finditer(r'href=["\'](/(?:[a-z]{2}/)?space/' + MP_ID_RE + r')', html_u):
        mid = _MP_SPACE_RE.search(m.group(1)).group(1)
        if mid not in ids:
            ids.append(mid)
    out = [matterport_show_url(i) for i in ids]
    for m in re.finditer(r"https?://(?:www\.)?zillow\.com/homedetails/[^\s\"'<>?#]+_zpid/?", html_u, re.I):
        if m.group(0) not in out:
            out.append(m.group(0))
    for m in re.finditer(r"https?://[^\s\"'<>]*view-imx[^\s\"'<>]*", html_u, re.I):
        if m.group(0) not in out:
            out.append(m.group(0))
    return out, "все туры на странице"


# На карточке объявления Zillow план этажа лежит в lightbox «Floor Plan»
# (вкладки Photos / Floor Plan / 3D Home). Настоящая картинка плана —
# чаще всего zillowstatic.com/floor_map/<id>/hero.png; дополнительно
# бывает compressed.svg. Без этого источника скрипт ошибочно считает,
# что плана нет, и строит только schematic_hypothesis.
_FLOOR_MAP_ASSET_RE = re.compile(
    r'https?://(?:www\.)?zillowstatic\.com/floor_map/[a-zA-Z0-9_\-./]+\.(?:png|jpg|jpeg|webp|svg)',
    re.I,
)
_FLOOR_PLAN_PHOTO_RE = re.compile(
    r'https?://photos\.zillowstatic\.com/fp/[a-zA-Z0-9]+(?:-[a-zA-Z0-9_]+)*\.(?:jpg|jpeg|png|webp)',
    re.I,
)


def find_zillow_listing_floor_plan_urls(html):
    """Достаёт URL-ы плана этажа из lightbox «Floor Plan» / карточки.
    Приоритет: hero.png (растровый план с размерами комнат) → прочие
    floor_map assets → фото рядом с mediatype=FLOOR_PLAN.
    Пустой список, если плана нет."""
    if not html:
        return []
    seen = set()
    heroes, others, photos = [], [], []

    def _is_tiny_photo(u):
        low = u.lower()
        for marker in ("-sr_", "-sc_192", "-sc_96", "-p_c.", "-p_e.", "_100w"):
            if marker in low:
                return True
        return False

    def _add(u, bucket):
        u = (u or "").replace("\\/", "/").split()[0].strip().rstrip(".,;)")
        if not u.startswith("http") or u in seen:
            return
        if "photos.zillowstatic.com" in u and _is_tiny_photo(u):
            return
        seen.add(u)
        bucket.append(u)

    for m in _FLOOR_MAP_ASSET_RE.finditer(html):
        u = m.group(0)
        if "/hero." in u.lower():
            _add(u, heroes)
        else:
            _add(u, others)

    for m in re.finditer(r'mediatype\s*=\s*["\']FLOOR_PLAN["\'](.{0,2500})', html, re.I | re.S):
        chunk = m.group(1)
        for um in _FLOOR_MAP_ASSET_RE.finditer(chunk):
            u = um.group(0)
            if "/hero." in u.lower():
                _add(u, heroes)
            else:
                _add(u, others)
        for um in _FLOOR_PLAN_PHOTO_RE.finditer(chunk):
            _add(um.group(0), photos)

    # img[data-testid=floor-map-tile-image]
    for m in re.finditer(
        r'data-testid=["\']floor-map-tile-image["\'][^>]*src=["\']([^"\']+)["\']'
        r'|src=["\']([^"\']+)["\'][^>]*data-testid=["\']floor-map-tile-image["\']',
        html, re.I,
    ):
        u = m.group(1) or m.group(2)
        if u and "floor_map" in u:
            if "/hero." in u.lower():
                _add(u, heroes)
            else:
                _add(u, others)

    return heroes + others + photos


# На части объявлений (типовой шаблон карточки, НЕ "showcase") вкладка
# «3D Home» внутри уже открытого lightbox «Floor Plan» не переводит
# страницу ни на отдельный URL (view-imx), ни на новый фрейм с
# window.__NEXT_DATA__/MP_PREFETCHED_MODELDATA — похоже, что панорамный
# просмотрщик рисуется прямо внутри lightbox по данным отдельного
# XHR/fetch/GraphQL-запроса, которые в DOM/window вообще не попадают.
# Раз так — данные тура можно попробовать поймать напрямую из сетевого
# ответа: см. GrabberApp._start_network_richmedia_watch(), которая слушает
# все JSON-ответы (начиная с открытия Floor Plan, не только вокруг клика
# по «3D Home») и прогоняет каждый через эту функцию в поисках вложенного
# словаря, по форме похожего на richMedia (непустой panos[] + хотя бы одно
# из panoLoc/visualizations/floors — тот же набор полей, что читает
# _process_zillow).
def _find_richmedia_in_obj(obj, max_nodes=20000, max_depth=10):
    """ГИПОТЕЗА (как deep_find_address выше): ищем в обходе JSON-ответа
    словарь, структурно похожий на richMedia. Ничего не ломает, если не
    находит — просто возвращает None."""
    counter = [0]

    def _walk(o, depth):
        if depth > max_depth or counter[0] > max_nodes:
            return None
        counter[0] += 1
        if isinstance(o, dict):
            panos = o.get("panos")
            if isinstance(panos, list) and panos and (
                "panoLoc" in o or "visualizations" in o or "floors" in o
            ):
                return o
            for v in o.values():
                r = _walk(v, depth + 1)
                if r is not None:
                    return r
        elif isinstance(o, list):
            for item in o:
                r = _walk(item, depth + 1)
                if r is not None:
                    return r
        return None

    try:
        return _walk(obj, 0)
    except Exception:
        return None


def next_zip_path(base_name=OUTPUT_BASENAME):
    if not os.path.exists(base_name):
        return base_name
    stem, ext = os.path.splitext(base_name)
    n = 1
    while True:
        candidate = f"{stem}({n}){ext}"
        if not os.path.exists(candidate):
            return candidate
        n += 1


# ---------------------------------------------------------------------
# Шаблон имени файла результата (задаётся в UI, обрабатывается как
# настоящая f-строка Python) + вспомогательное извлечение доп. свойств
# (адрес, zpid), которые в этот шаблон можно подставлять.
# ---------------------------------------------------------------------

_ZPID_RE = re.compile(r"/(\d+)_zpid", re.I)


def extract_zpid(url):
    """Достаёт ZPID из обычной ссылки на объявление Zillow вида
    .../homedetails/.../<zpid>_zpid/. Возвращает None, если не нашёл."""
    if not url:
        return None
    m = _ZPID_RE.search(url)
    return m.group(1) if m else None


def _lot_sqft_from_value(value, unit=None):
    """Число + единица → квадратные футы. Понимает sqft / square feet / acres
    (в т.ч. строки вида «5,227 sqft», «0.25 Acres»). None, если не похоже на площадь."""
    try:
        if value is None:
            return None
        if isinstance(value, str):
            m = re.search(r"([\d][\d,\.]*)\s*(sq\.?\s*ft|sqft|square\s*feet|sf|acres?|ac)?", value, re.I)
            if not m:
                return None
            num = float(m.group(1).replace(",", ""))
            unit = unit or m.group(2) or ""
        else:
            num = float(value)
        u = str(unit or "sqft").lower()
        sq = num * ACRE_TO_SQFT if ("acre" in u or u.strip() == "ac") else num
        if 100 <= sq <= 5e8:
            return int(round(sq))
    except Exception:
        return None
    return None


def find_lot_sqft(obj, max_nodes=60000, max_depth=12):
    """Площадь участка (земли) в квадратных футах из данных Zillow.
    Где встречается: property.lotAreaValue + lotAreaUnits («Square Feet» /
    «Acres»), property.lotSize (число, sqft), resoFacts.lotSize («5,227 sqft» /
    «0.25 Acres»). У Zillow часть данных лежит внутри JSON-строк
    (gdpClientCache) — такие строки тоже разбираем. Никогда не бросает."""
    counter = [0]
    found = []

    def _walk(o, depth):
        if depth > max_depth or counter[0] > max_nodes:
            return
        counter[0] += 1
        if isinstance(o, str):
            t = o.lstrip()
            if len(t) > 50 and t[:1] in "{[" and ("lotArea" in t or "lotSize" in t):
                try:
                    _walk(json.loads(t), depth + 1)
                except Exception:
                    pass
            return
        if isinstance(o, dict):
            keys = {k.lower(): k for k in o.keys() if isinstance(k, str)}
            if "lotareavalue" in keys:
                unit = o.get(keys.get("lotareaunits") or keys.get("lotareaunit") or "", None)
                v = _lot_sqft_from_value(o.get(keys["lotareavalue"]), unit)
                if v:
                    found.append((0, v))
            if "lotsize" in keys:
                raw = o.get(keys["lotsize"])
                v = _lot_sqft_from_value(raw)
                if v:
                    found.append((1 if isinstance(raw, (int, float)) else 2, v))
            for k in ("lotsizesquarefeet", "lotsizesqft"):
                if k in keys:
                    v = _lot_sqft_from_value(o.get(keys[k]), "sqft")
                    if v:
                        found.append((1, v))
            for v in o.values():
                _walk(v, depth + 1)
        elif isinstance(o, list):
            for it in o:
                _walk(it, depth + 1)

    try:
        _walk(obj, 0)
    except Exception:
        return None
    if not found:
        return None
    found.sort(key=lambda t: t[0])
    return found[0][1]


def find_lot_sqft_in_text(text):
    """Запасной путь — по тексту страницы: «Lot size: 5,227 sqft»,
    «0.25 Acres lot», «Lot: 6,000 sqft»."""
    if not text:
        return None
    pats = (
        r"lot\s*(?:size|area)?\s*[:\-]?\s*([\d][\d,\.]*)\s*(sq\.?\s*ft|sqft|square\s*feet|acres?)",
        r"([\d][\d,\.]*)\s*(sq\.?\s*ft|sqft|square\s*feet|acres?)\s*lot\b",
    )
    for p in pats:
        m = re.search(p, text, re.I)
        if m:
            v = _lot_sqft_from_value(m.group(1), m.group(2))
            if v:
                return v
    return None


def cleanup_empty_units(name):
    """Если площадь не найдена, из имени убирается «пустой» кусок вроде
    « - m2» / « - sqft», чтобы не было «…panoramas - m2»."""
    name = re.sub(r"\s*-\s*(?:m2|sqft)(?=\s*(?:-|$))", "", name)
    return name.strip()


def deep_find_address(obj, max_nodes=40000, max_depth=8):
    """ГИПОТЕЗА/лучшая попытка (как first_number() ниже для угла): ищем
    где-то в глубине __NEXT_DATA__ словарь с полями streetAddress+city
    (в любом регистре) и собираем из них человекочитаемый адрес. Zillow
    официально не гарантирует, что адрес вообще лежит в richMedia/кэше
    в таком виде — это просто защитная попытка, которая ничего не
    ломает, если ничего не находит. Ограничено по глубине и числу
    обойдённых узлов, чтобы не подвешивать программу на очень больших
    страницах."""
    counter = [0]

    def _walk(o, depth):
        if depth > max_depth or counter[0] > max_nodes:
            return None
        counter[0] += 1
        if isinstance(o, dict):
            lower = {k.lower(): k for k in o.keys()}
            if "streetaddress" in lower and "city" in lower:
                street = o.get(lower["streetaddress"])
                city = o.get(lower["city"])
                state = o.get(lower.get("state", ""))
                zipc = o.get(lower.get("zipcode") or lower.get("postalcode", ""))
                line2 = " ".join(str(p) for p in (city, state, zipc) if p)
                addr = ", ".join(p for p in (str(street) if street else "", line2) if p)
                if addr:
                    return addr
            for v in o.values():
                r = _walk(v, depth + 1)
                if r:
                    return r
        elif isinstance(o, list):
            for item in o:
                r = _walk(item, depth + 1)
                if r:
                    return r
        return None

    try:
        return _walk(obj, 0)
    except Exception:
        return None


def stringify_address(addr):
    """meta['address'] у Zillow — уже строка (deep_find_address), а у
    Matterport — это как есть publication.address из GetRootPrefetch,
    структура которого явно не документирована и может оказаться словарём.
    Приводим к читаемой строке в обоих случаях, чтобы её можно было прямо
    подставлять в шаблон имени файла."""
    if not addr:
        return ""
    if isinstance(addr, str):
        return addr
    if isinstance(addr, dict):
        for key in ("full", "formatted", "line1", "address"):
            if addr.get(key):
                return str(addr[key])
        parts = [v for v in addr.values() if isinstance(v, str) and v.strip()]
        if parts:
            return ", ".join(parts)
    return str(addr)


def sanitize_filename_result(s, maxlen=150):
    """Приводит результат рендера шаблона имени к тому, что можно
    безопасно использовать как имя файла на любой ОС: переносы строк —
    в пробел, запрещённые в путях символы \\ / : * ? " < > | — в «_»."""
    s = re.sub(r"[\r\n]+", " ", str(s))
    s = re.sub(r'[\\/:*?"<>|]+', "_", s)
    s = s.strip().strip(".")
    return s[:maxlen] or "tour"


def render_name_template(template, context):
    """Обрабатывает шаблон имени как настоящую f-строку Python: внутри
    {...} работают любые выражения и спецификаторы формата (например
    {fl_count:02d}, {address.upper() if address else 'noaddr'}), а не
    только простая подстановка str.format(). Реализовано через честный
    eval динамически собранной f-строки в изолированном пространстве
    имён — без __builtins__ и без доступа к чему-либо, кроме значений
    из context, так что даже сам код шаблона не может выйти за пределы
    предоставленных переменных."""
    template = template if template and template.strip() else DEFAULT_NAME_TEMPLATE
    # экранируем то, что сломало бы обрамляющие тройные кавычки
    escaped = template.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')
    code = 'f"""' + escaped + '"""'
    try:
        compiled = compile(code, "<name_template>", "eval")
        result = eval(compiled, {"__builtins__": {}}, dict(context))
    except Exception as e:
        raise ValueError(f"ошибка в шаблоне имени «{template}»: {e}")
    return str(result)


def safe_room(s):
    if not s:
        return ""
    s = re.sub(r"\s+", "_", str(s).strip())
    s = re.sub(r"[^\w\-]+", "", s, flags=re.UNICODE)
    return s[:40]


def safe_filename(s, maxlen=60):
    s = re.sub(r"[^\w\-\.]+", "_", str(s), flags=re.UNICODE)
    return s[:maxlen]


def room_label_from_tags(tags):
    if not tags:
        return None
    return "+".join(tags)


# Zillow отдаёт клиенту ПОЛНУЮ реконструкцию тура (см. behind-the-scenes:
# essential-matrix pose estimation между панорамами + IMU-траектории для
# связей, снятых на ходу) — то есть у них ЕСТЬ настоящая ориентация каждой
# точки и точный азимут перехода к каждому соседу. Мы ни разу не видели её
# в structured-полях richMedia (destinations{} у панорамы содержит только
# destEntityId/title, а panoLoc.world[] — только center{x,y,z}), но названия
# полей могут отличаться в разных версиях фронтенда/API, поэтому здесь —
# защитная, ничего не ломающая попытка подхватить угол/поворот, если он
# всё-таки где-то лежит под одним из привычных имён. Если ни одного из этих
# полей нет (типичный случай на сегодня) — просто возвращает None, и тот,
# кто строит навигацию по links.json, откатывается на собственную оценку
# азимута по мировым координатам соседних точек.
_ANGLE_KEYS = ("angleDeg", "angle", "degrees", "heading", "bearing", "departureAngle", "arrivalAngle", "yaw", "yawDeg")


def first_number(d, keys=_ANGLE_KEYS):
    if not isinstance(d, dict):
        return None
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return v
    return None


def pick_best_skybox(skyboxes):
    best, best_rank = None, -1
    for sb in (skyboxes or []):
        if sb.get("status") != "available" or not sb.get("urlTemplate"):
            continue
        rank = RESOLUTION_RANK.get(sb.get("resolution"), 0)
        if rank > best_rank:
            best_rank, best = rank, sb
    if best is None:
        return None, None
    return best.get("resolution"), best


AVIF_QUALITY = 60          # качество AVIF для фото Matterport (как у Zillow; ~в 2 раза меньше JPG)


_AVIF_STATE = {"checked": False, "mode": None}


def avif_mode():
    """'pillow' — AVIF встроен в Pillow (>= 11.3), 'plugin' — pillow-avif-plugin, None — AVIF нет."""
    if _AVIF_STATE["checked"]:
        return _AVIF_STATE["mode"]
    mode = None
    try:
        from PIL import features
        if features.check("avif"):
            mode = "pillow"
    except Exception:
        pass
    if mode is None:
        try:
            import pillow_avif  # noqa: F401  (pip install pillow-avif-plugin)
            mode = "plugin"
        except Exception:
            pass
    _AVIF_STATE.update(checked=True, mode=mode)
    return mode


AVIF_HINT = ("AVIF недоступен в Pillow — для сжатия фото в ~2 раза выполните: "
             "python3 -m pip install -U Pillow   (нужна версия 11.3+), "
             "или: python3 -m pip install pillow-avif-plugin")
EQUIRECT_JPG_QUALITY = 78  # если AVIF нет — круговая панорама JPG (грани при этом не трогаем)


def image_save_compressed(img, path_no_ext, quality=AVIF_QUALITY):
    """Сохранить PIL-картинку в AVIF (если есть), иначе в JPG (q78, optimize).
    → путь сохранённого файла (с расширением)."""
    mode = avif_mode()
    if mode:
        try:
            out = path_no_ext + ".avif"
            if mode == "pillow":
                img.save(out, "AVIF", quality=quality, speed=8)
            else:
                img.save(out, "AVIF", quality=quality)
            return out
        except Exception:
            pass
    out = path_no_ext + ".jpg"
    img.save(out, "JPEG", quality=EQUIRECT_JPG_QUALITY, optimize=True, progressive=True)
    return out


_EQUIRECT_MAPS = {}
_EQUIRECT_LOCK = threading.Lock()


def _equirect_map(s, w):
    """Таблица «пиксель панорамы → (грань, x, y)» для граней s×s и панорамы w×w/2.
    Считается один раз на размер и переиспользуется для всех точек тура (экономит память и время)."""
    import numpy as np
    key = (s, w)
    with _EQUIRECT_LOCK:
        if key in _EQUIRECT_MAPS:
            return _EQUIRECT_MAPS[key]
        h = w // 2
        lon = ((np.arange(w, dtype=np.float32) + 0.5) / w * 2 - 1) * np.float32(np.pi)
        lat = np.float32(np.pi / 2) - (np.arange(h, dtype=np.float32) + 0.5) / h * np.float32(np.pi)
        lon, lat = np.meshgrid(lon, lat)
        cl = np.cos(lat)
        x, y, z = cl * np.sin(lon), np.sin(lat), cl * np.cos(lon)
        del cl, lon, lat
        ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
        u = np.zeros_like(x)
        v = np.zeros_like(x)
        f = np.zeros(x.shape, dtype=np.int8)

        def put(m, uu, vv, idx):
            u[m], v[m], f[m] = uu[m], vv[m], idx

        side = ay < np.maximum(ax, az)
        with np.errstate(divide="ignore", invalid="ignore"):
            put(side & (az >= ax) & (z > 0), x / az, -y / az, 1)     # вперёд
            put(side & (ax > az) & (x > 0), -z / ax, -y / ax, 2)     # вправо
            put(side & (az >= ax) & (z <= 0), -x / az, -y / az, 3)   # назад
            put(side & (ax > az) & (x <= 0), z / ax, -y / ax, 4)     # влево
            put(~side & (y > 0), x / ay, z / ay, 0)                  # верх
            put(~side & (y <= 0), x / ay, -z / ay, 5)                # низ
        px = np.clip(((u + 1) / 2 * s).astype(np.int32), 0, s - 1).astype(np.int16)
        py = np.clip(((v + 1) / 2 * s).astype(np.int32), 0, s - 1).astype(np.int16)
        masks = [np.nonzero(f == i) for i in range(6)]
        _EQUIRECT_MAPS[key] = (masks, px, py)
        return _EQUIRECT_MAPS[key]


def stitch_equirect(face_paths, out_path_no_ext, out_width=None):
    """Склейка 6 граней куба Matterport в круговую (эквиректангулярную) панораму.
    Раскладка ПРОВЕРЕНА по стыкам граней на реальном туре (раунд 69):
      face0 = верх, face1..face4 = стороны по кругу вправо (face1 — «вперёд», центр кадра),
      face5 = низ; верх примыкает к face1 своим нижним краем, низ — верхним.
    (Прежняя «гипотеза» с раскладкой WebGL +X,-X,+Y,-Y,+Z,-Z давала перемешанную картинку.)
    out_width по умолчанию = 2 × сторона грани, но не больше 4096.
    → имя сохранённого файла (.avif, или .jpg если AVIF недоступен) либо None."""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return None
    try:
        faces = [np.asarray(Image.open(p).convert("RGB"), dtype=np.uint8) for p in face_paths]
        if len(faces) != 6 or len({f.shape for f in faces}) != 1:
            return None
        s = faces[0].shape[0]
        w = out_width or min(4096, 2 * s)
        w -= w % 2
        masks, px, py = _equirect_map(s, w)
        out = np.zeros((w // 2, w, 3), dtype=np.uint8)
        for i in range(6):
            rr, cc = masks[i]
            out[rr, cc] = faces[i][py[rr, cc], px[rr, cc]]
        del faces
        return os.path.basename(image_save_compressed(Image.fromarray(out, "RGB"), out_path_no_ext))
    except Exception:
        return None


def compress_face_file(path_jpg):
    """Грань куба (JPG от Matterport) → AVIF рядом; исходный JPG удаляется. → новое имя файла.
    Раунд 70: если AVIF нет — грань НЕ трогаем (пережатие JPG→JPG только увеличивало архив)."""
    if not avif_mode():
        return os.path.basename(path_jpg)
    try:
        from PIL import Image
        with Image.open(path_jpg) as im:
            im.load()
            out = image_save_compressed(im.convert("RGB"), os.path.splitext(path_jpg)[0])
        if not out.endswith(".avif"):
            if os.path.abspath(out) != os.path.abspath(path_jpg) and os.path.exists(out):
                os.remove(out)
            return os.path.basename(path_jpg)
        if os.path.getsize(out) >= os.path.getsize(path_jpg):   # AVIF вышел не меньше — оставляем JPG
            os.remove(out)
            return os.path.basename(path_jpg)
        os.remove(path_jpg)
        return os.path.basename(out)
    except Exception:
        return os.path.basename(path_jpg)


# ---------------------------------------------------------------------
# Matterport: 3D-модель .dam → настоящий 2D-план этажа (раунд 70)
# ---------------------------------------------------------------------
# .dam — protobuf: повторяющееся поле 1 = кусок сетки {1: вершины {1: xyz float32[], 2: uv float32[]},
# 2: грани {1: индексы varint[]}, 3: имя куска, 4: имя текстуры}. Оси: X/Y — горизонталь, Z — вверх
# (в тех же координатах, что position у точек съёмки). Проверено на реальной модели 50k.

def _pb_varint(b, i):
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, i


def _pb_fields(b):
    i, out, n = 0, [], len(b)
    while i < n:
        key, i = _pb_varint(b, i)
        f, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _pb_varint(b, i)
        elif wt == 1:
            v = b[i:i + 8]
            i += 8
        elif wt == 5:
            v = b[i:i + 4]
            i += 4
        elif wt == 2:
            ln, i = _pb_varint(b, i)
            v = b[i:i + ln]
            i += ln
        else:
            raise ValueError(f"protobuf: тип поля {wt}")
        out.append((f, wt, v))
    return out


def _pb_packed_varints(b):
    import numpy as np
    a = np.frombuffer(b, dtype=np.uint8)
    if a.size and not (a & 0x80).any():          # все индексы < 128 — быстрый путь
        return a.astype(np.int64)
    out, i, n = [], 0, len(b)
    while i < n:
        v, i = _pb_varint(b, i)
        out.append(v)
    return np.asarray(out, dtype=np.int64)


def load_dam_mesh(path):
    """→ (P: float32[N,3], F: int64[M,3]) — все куски сетки вместе."""
    import numpy as np
    with open(path, "rb") as fh:
        data = fh.read()
    Ps, Fs, off = [], [], 0
    for f, wt, chunk in _pb_fields(data):
        if f != 1 or wt != 2:
            continue
        sub = {}
        for ff, ww, vv in _pb_fields(chunk):
            if ww == 2:
                sub.setdefault(ff, vv)
        if 1 not in sub or 2 not in sub:
            continue
        verts = {ff: vv for ff, ww, vv in _pb_fields(sub[1]) if ww == 2}
        faces = [vv for ff, ww, vv in _pb_fields(sub[2]) if ff == 1 and ww == 2]
        if 1 not in verts or not faces:
            continue
        xyz = np.frombuffer(verts[1], dtype="<f4")
        xyz = xyz[: len(xyz) // 3 * 3].reshape(-1, 3)
        idx = _pb_packed_varints(faces[0])
        idx = idx[: len(idx) // 3 * 3].reshape(-1, 3)
        if idx.size == 0 or idx.max() >= len(xyz):
            continue
        Ps.append(xyz)
        Fs.append(idx + off)
        off += len(xyz)
    if not Ps:
        raise ValueError("в .dam не найдено ни одного куска сетки")
    return np.vstack(Ps).astype(np.float32), np.vstack(Fs)


def mesh_slice_segments(tri, z):
    """Горизонтальный срез треугольников tri[M,3,3] плоскостью Z=z → отрезки [K,2,2] (X/Y)."""
    import numpy as np
    d = tri[:, :, 2] - z
    m = (d.min(1) < 0) & (d.max(1) > 0)
    t, dd = tri[m], d[m]
    if not len(t):
        return np.zeros((0, 2, 2), dtype=np.float32)
    cs, ps = [], []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        c = (dd[:, a] * dd[:, b]) < 0
        r = dd[:, a] / np.where(c, dd[:, a] - dd[:, b], 1.0)
        cs.append(c)
        ps.append(t[:, a, :2] + (t[:, b, :2] - t[:, a, :2]) * r[:, None])
    cs, ps = np.stack(cs, 1), np.stack(ps, 1)
    ok = cs.sum(1) == 2
    cs, ps = cs[ok], ps[ok]
    first = np.argmax(cs, 1)
    last = 2 - np.argmax(cs[:, ::-1], 1)
    k = np.arange(len(ps))
    return np.stack([ps[k, first], ps[k, last]], 1)


def floor_levels_from_points(points):
    """points: [{floorId, fz}] (fz — высота пола под камерой) → {floorId: уровень пола} (медиана нижней половины)."""
    by = {}
    for p in points:
        if p.get("fz") is not None:
            by.setdefault(p["floorId"], []).append(p["fz"])
    lv = {}
    for fid, zs in by.items():
        zs = sorted(zs)
        med = zs[len(zs) // 2]
        low = [z for z in zs if z <= med + 0.1]
        lv[fid] = low[len(low) // 2]
    return lv


def _plan_dominant_angle(segs):
    """Преобладающее направление стен (0..90°) по длинам отрезков среза."""
    import numpy as np
    d = segs[:, 1] - segs[:, 0]
    ln = np.hypot(d[:, 0], d[:, 1])
    ang = np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 90.0
    hist = np.bincount(np.round(ang).astype(int) % 90, weights=ln, minlength=90)
    k = np.array([1, 2, 3, 2, 1], dtype=float)
    sm = np.array([sum(hist[(i + j - 2) % 90] * k[j] for j in range(5)) for i in range(90)])
    i = int(np.argmax(sm))
    # уточнение средним в окне ±3°
    w = [((i + j) % 90, hist[(i + j) % 90]) for j in range(-3, 4)]
    tot = sum(v for _, v in w) or 1.0
    ref = i + sum(j * hist[(i + j) % 90] for j in range(-3, 4)) / tot
    return ref % 90.0


def _plan_merge_lines(items, gap_merge, coord_tol, min_len):
    """items: [(c, a, b, weight)] для одной оси (c — поперечная координата).
    → [(c, a, b)] слитые линии."""
    import numpy as np
    items = sorted(items, key=lambda t: t[0])
    clusters, cur = [], []
    for it in items:
        if cur and it[0] - np.average([x[0] for x in cur], weights=[x[3] for x in cur]) > coord_tol:
            clusters.append(cur)
            cur = []
        cur.append(it)
    if cur:
        clusters.append(cur)
    out = []
    for cl in clusters:
        ivs = sorted(cl, key=lambda t: t[1])
        run = [ivs[0]]
        run_b = ivs[0][2]
        groups = []
        for it in ivs[1:]:
            if it[1] <= run_b + gap_merge:
                run.append(it)
                run_b = max(run_b, it[2])
            else:
                groups.append(run)
                run, run_b = [it], it[2]
        groups.append(run)
        for g in groups:
            a = min(t[1] for t in g)
            b = max(t[2] for t in g)
            if b - a < min_len:
                continue
            c = float(np.average([t[0] for t in g], weights=[t[3] for t in g]))
            out.append((c, a, b))
    return out


def straighten_wall_segments(segs, snap_deg=14.0, coord_tol=0.06, gap_merge=0.14, min_len=0.12):
    """Срез стен (много мелких отрезков) → ровные стены: направления притягиваются к двум
    главным осям помещения, соседние отрезки на одной линии сливаются, концы стен
    «дотягиваются» до перпендикулярных стен. → (линии [(x1,y1,x2,y2)], угол осей в градусах)."""
    import numpy as np
    if not len(segs):
        return [], 0.0
    th = _plan_dominant_angle(segs)
    t = math.radians(th)
    R = np.array([[math.cos(t), math.sin(t)], [-math.sin(t), math.cos(t)]])   # мир → оси помещения
    Ri = R.T
    s = segs @ R.T
    d = s[:, 1] - s[:, 0]
    ln = np.hypot(d[:, 0], d[:, 1])
    ang = np.degrees(np.arctan2(d[:, 1], d[:, 0])) % 180.0
    horiz = (ang < snap_deg) | (ang > 180 - snap_deg)
    vert = np.abs(ang - 90) < snap_deg
    H = [((s[i, 0, 1] + s[i, 1, 1]) / 2, min(s[i, 0, 0], s[i, 1, 0]), max(s[i, 0, 0], s[i, 1, 0]), ln[i])
         for i in np.nonzero(horiz)[0]]
    V = [((s[i, 0, 0] + s[i, 1, 0]) / 2, min(s[i, 0, 1], s[i, 1, 1]), max(s[i, 0, 1], s[i, 1, 1]), ln[i])
         for i in np.nonzero(vert)[0]]
    Hm = _plan_merge_lines(H, gap_merge, coord_tol, min_len) if H else []
    Vm = _plan_merge_lines(V, gap_merge, coord_tol, min_len) if V else []
    # дотягиваем концы до перпендикулярных стен (углы без щелей)
    reach = 0.18

    def snap_end(val, c_self, others):
        best, bd = val, reach
        for (c, a, b) in others:
            if a - reach <= c_self <= b + reach and abs(c - val) < bd:
                best, bd = c, abs(c - val)
        return best
    Hs = [(c, snap_end(a, c, Vm), snap_end(b, c, Vm)) for (c, a, b) in Hm]
    Vs = [(c, snap_end(a, c, Hm), snap_end(b, c, Hm)) for (c, a, b) in Vm]
    lines = []
    for (c, a, b) in Hs:
        p = np.array([[a, c], [b, c]]) @ Ri.T
        lines.append((p[0, 0], p[0, 1], p[1, 0], p[1, 1]))
    for (c, a, b) in Vs:
        p = np.array([[c, a], [c, b]]) @ Ri.T
        lines.append((p[0, 0], p[0, 1], p[1, 0], p[1, 1]))
    # косые стены: только длинные цепочки (коротыши — мебель/шум)
    diag = ~(horiz | vert)
    if diag.any():
        D = s[diag]
        dd = D[:, 1] - D[:, 0]
        a2 = (np.degrees(np.arctan2(dd[:, 1], dd[:, 0])) % 180.0)
        # группируем по углу (±6°) и поперечной координате, как для осевых стен
        for base in np.unique(np.round(a2 / 6.0) * 6.0):
            m = np.abs(a2 - base) < 3.0 + 1e-9
            if not m.any():
                continue
            tt = math.radians(base)
            R2 = np.array([[math.cos(tt), math.sin(tt)], [-math.sin(tt), math.cos(tt)]])
            q = D[m] @ R2.T
            L = np.hypot(*(q[:, 1] - q[:, 0]).T)
            items = [((q[i, 0, 1] + q[i, 1, 1]) / 2, min(q[i, 0, 0], q[i, 1, 0]), max(q[i, 0, 0], q[i, 1, 0]), L[i])
                     for i in range(len(q))]
            for (c, a, b) in _plan_merge_lines(items, 0.06, 0.04, 0.35):
                p = (np.array([[a, c], [b, c]]) @ R2) @ Ri.T
                lines.append((p[0, 0], p[0, 1], p[1, 0], p[1, 1]))
    return lines, th


def _plan_filter_persistent(segs, other, tol=0.06):
    """Оставить отрезки среза, у которых рядом есть срез на другой высоте (стена идёт вверх),
    — отсекает мебель, спинки сидений, столешницы."""
    import numpy as np
    if not len(segs) or not len(other):
        return segs
    cell = tol
    keys = set()
    for a, b in other:
        L = float(np.hypot(*(b - a)))
        for t in np.linspace(0, 1, max(2, int(L / cell) + 2)):
            p = a + (b - a) * t
            keys.add((int(np.floor(p[0] / cell)), int(np.floor(p[1] / cell))))
    keep = []
    for i, (a, b) in enumerate(segs):
        hit = tot = 0
        L = float(np.hypot(*(b - a)))
        for t in np.linspace(0, 1, max(2, int(L / cell) + 2)):
            p = a + (b - a) * t
            cx, cy = int(np.floor(p[0] / cell)), int(np.floor(p[1] / cell))
            tot += 1
            if any((cx + dx, cy + dy) in keys for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                hit += 1
        if hit >= 0.5 * tot:
            keep.append(i)
    return segs[keep]


def render_mesh_plan(P, F, floor_z, ceil_z, cam_xy, out_path, label=None, long_side=1600, stand_z=None):
    """Раунд 73: план этажа в стиле Zillow — прозрачный фон, светлая площадь этажа, ровные тёмные стены.
    Стены: срез сетки на 1.1 м, подтверждённый срезом на 0.75 или 1.5 м (мебель отпадает), направления
    притянуты к главным осям помещения, соседние куски слиты, углы сомкнуты. Площадь: силуэт всего,
    что от пола до ~2 м, со сглаженным краем и тонким контуром. → dict преобразования."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    tri = P[F]
    zc = tri[:, :, 2].mean(1)
    zmin = tri[:, :, 2].min(1)
    top = ceil_z - 0.25 if ceil_z is not None else np.inf
    band = (zc > floor_z - 0.3) & (zc < top)
    t_all = tri[band]
    # стены: срез на 1.1 м, подтверждённый срезом выше (1.5 м) — мебель отпадает
    raw = mesh_slice_segments(t_all, floor_z + 1.1)
    hi_z = floor_z + 1.5 if ceil_z is None or floor_z + 1.5 < ceil_z - 0.3 else floor_z + 1.3
    other = [mesh_slice_segments(t_all, hi_z), mesh_slice_segments(t_all, floor_z + 0.75)]
    other = np.concatenate([o for o in other if len(o)]) if any(len(o) for o in other) else np.zeros((0, 2, 2))
    raw = _plan_filter_persistent(raw, other)
    walls, th = straighten_wall_segments(raw)
    # внутренняя площадь этажа = всё, что от пола и до ~2 м (пол, мебель, стены) при виде сверху
    inner = t_all[(zmin[band] < floor_z + 2.0)]
    pts = [inner.reshape(-1, 3)[:, :2]]
    if walls:
        pts.append(np.array(walls, dtype=np.float32).reshape(-1, 2))
    if cam_xy:
        pts.append(np.asarray(cam_xy, dtype=np.float32))
    allp = np.vstack([p for p in pts if len(p)])
    lo = np.percentile(allp, 0.2, axis=0); hi = np.percentile(allp, 99.8, axis=0)
    if cam_xy:
        c = np.asarray(cam_xy, dtype=np.float32); lo, hi = np.minimum(lo, c.min(0)), np.maximum(hi, c.max(0))
    span = np.maximum(hi - lo, 1.0)
    mm = 0.05 * float(span.max()) + 0.25
    lo, hi = lo - mm, hi + mm
    s = long_side / float(max(hi - lo))
    bar_h = 44
    W, H = int((hi[0] - lo[0]) * s), int((hi[1] - lo[1]) * s) + bar_h
    ox, oy = float(lo[0]), float(hi[1])

    # --- пол: силуэт на грубой сетке (2 см) → закрыть щели → сгладить → в полный размер ---
    g = max(0.02, float(max(hi - lo)) / 1500.0)          # м на клетку
    gw, gh = int(W / s / g) + 1, int(H / s / g) + 1
    m = Image.new("L", (gw, gh), 0)
    d = ImageDraw.Draw(m)
    for t in inner:
        x = (t[:, 0] - ox) / g
        y = (oy - t[:, 1]) / g
        d.polygon(list(zip(x.tolist(), y.tolist())), fill=255)
    for (x1, y1, x2, y2) in walls:
        d.line([((x1 - ox) / g, (oy - y1) / g), ((x2 - ox) / g, (oy - y2) / g)], fill=255, width=4)
    close = 7   # ~14 см
    m = m.filter(ImageFilter.MaxFilter(close)).filter(ImageFilter.MinFilter(close))
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    SS = 3
    S = s * SS
    fm = m.resize((W * SS, H * SS), Image.BILINEAR).filter(ImageFilter.GaussianBlur(SS * 2.0))
    fm = fm.point(lambda v: 255 if v >= 128 else 0)

    def tp(xy):
        xy = np.asarray(xy, dtype=np.float64)
        return (xy[..., 0] - ox) * S, (oy - xy[..., 1]) * S

    img = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    # контур площади (там, где стены не нашлись, край всё равно аккуратный)
    edge = fm.filter(ImageFilter.MaxFilter(3 * SS if (3 * SS) % 2 else 3 * SS + 1))
    img.paste(Image.new("RGBA", img.size, (78, 82, 90, 255)), (0, 0), edge)
    img.paste(Image.new("RGBA", img.size, (246, 244, 240, 255)), (0, 0), fm)
    d = ImageDraw.Draw(img)
    W_T = 0.09
    ww = max(3, int(W_T * S))

    def stroke(width, color):
        r = width / 2
        for (x1, y1, x2, y2) in walls:
            x, y = tp([[x1, y1], [x2, y2]])
            d.line(list(zip(x.tolist(), y.tolist())), fill=color, width=int(width))
            for px, py in zip(x.tolist(), y.tolist()):
                d.ellipse([px - r, py - r, px + r, py + r], fill=color)
    stroke(ww + 2 * SS * 2, (255, 255, 255, 235))    # светлый кант — стены видны и на тёмном фоне
    stroke(ww, (46, 48, 54, 255))
    img = img.resize((W, H), Image.LANCZOS)
    d = ImageDraw.Draw(img)
    try:
        fnt = ImageFont.load_default(size=16)
    except Exception:
        fnt = None
    txt = "1 m" + (f"  ·  {label}" if label else "")
    try:
        tw = d.textlength(txt, font=fnt)
    except Exception:
        tw = 8 * len(txt)
    x0, y0 = 14, H - 24
    d.rounded_rectangle([x0 - 8, y0 - 16, x0 + s + 16 + tw + 8, y0 + 14], radius=8, fill=(255, 255, 255, 225))
    d.line([(x0, y0), (x0 + s, y0)], fill=(40, 40, 45, 255), width=3)
    d.line([(x0, y0 - 6), (x0, y0 + 6)], fill=(40, 40, 45, 255), width=2)
    d.line([(x0 + s, y0 - 6), (x0 + s, y0 + 6)], fill=(40, 40, 45, 255), width=2)
    d.text((x0 + s + 10, y0 - 9), txt, fill=(40, 40, 45, 255), font=fnt)
    img.save(out_path)
    return {"pxPerMeter": round(s, 4), "originX": round(ox, 4), "originY": round(oy, 4),
            "width": W, "height": H, "wallSliceZ": round(floor_z + 1.1, 3), "wallAxesDeg": round(float(th), 2)}


# ---------------------------------------------------------------------
# Параллельная загрузка файлов с автоповтором
# ---------------------------------------------------------------------

class DownloadTask:
    """Одна задача на скачивание: url → path. meta — произвольные данные,
    которые вызывающий код прикрепляет, чтобы после (возможно, отложенного
    во времени из-за повторов) завершения загрузки понять, к какому
    пано/грани/плану она относится."""

    __slots__ = ("url", "path", "label", "meta", "success")

    def __init__(self, url, path, label="", meta=None):
        self.url = url
        self.path = path
        self.label = label
        self.meta = meta or {}
        self.success = False


def download_file(url, path, cookies_header="", referer="", log_fn=None):
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": "*/*",
            },
        )
        if cookies_header:
            req.add_header("Cookie", cookies_header)
        if referer:
            req.add_header("Referer", referer)
        with urllib.request.urlopen(req, timeout=90, context=SSL_CTX) as resp:
            data = resp.read()
        if len(data) < 200:
            if log_fn:
                log_fn(f"[скачивание] подозрительно маленький ответ ({len(data)} байт): {url}")
            return False
        with open(path, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        if log_fn:
            log_fn(f"[скачивание] ошибка: {url} — {e}")
        return False


def plan_svg_rooms(svg_text):
    """Комнаты на официальном SVG-плане этажа Zillow: группы
    <g id="…" class="note" data-room="…"> с многоугольником площади
    (class="dimensionsArea"). Это ровно подписанные на плане помещения с
    размерами («Bedroom 10'5" x 11'9"», «Closet …»); подписи без площади
    («Entry», «Fireplace») комнатами не считаются.
    → {note_id: label}"""
    out = {}
    if not svg_text:
        return out
    starts = [m for m in re.finditer(r'<g id="([0-9a-fA-F]+)" class="note"[^>]*>', svg_text)]
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(svg_text)
        seg = svg_text[m.end():end]
        if 'dimensionsArea' not in seg:
            continue
        li = seg.find('class="label"')
        lj = seg.find('class="dimensionLabel"', li if li >= 0 else 0)
        part = seg[li:lj if lj > li else len(seg)] if li >= 0 else ""
        label = " ".join(html_unescape(t).strip() for t in re.findall(r'<text[^>]*>([^<]*)</text>', part)).strip()
        out[m.group(1).lower()] = label
    return out



def plan_svg_rooms_full(svg_text):
    """Как plan_svg_rooms, но с размерами: {note_id: (label, dims)}."""
    out = {}
    if not svg_text:
        return out
    starts = [m for m in re.finditer(r'<g id="([0-9a-fA-F]+)" class="note"[^>]*>', svg_text)]
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(svg_text)
        seg = svg_text[m.end():end]
        if 'dimensionsArea' not in seg:
            continue
        li = seg.find('class="label"')
        lj = seg.find('class="dimensionLabel"', li if li >= 0 else 0)
        part = seg[li:lj if lj > li else len(seg)] if li >= 0 else ""
        label = " ".join(html_unescape(t).strip() for t in re.findall(r'<text[^>]*>([^<]*)</text>', part)).strip()
        dm = re.search(r'class="dimensionLabel".*?<text[^>]*>([^<]*)</text>', seg, re.S)
        dims = html_unescape(dm.group(1)).strip() if dm else ""
        if re.fullmatch(r"placeholder", label, re.I):
            continue   # служебная заглушка Zillow, не помещение
        out[m.group(1).lower()] = (label, dims)
    return out


# ---------------------------------------------------------------------
# Подписи комнат из SVG-плана → в пикселях растрового плана (для PALACE/index.html)
# ---------------------------------------------------------------------
# Раньше index.html сам рендерил SVG в браузере, чтобы узнать, где стоит каждая
# подпись (а для планов без SVG — распознавал их OCR). Grabber знает SVG и размер
# PNG заранее, поэтому считает то же самое здесь: вложенные transform (translate/
# rotate/scale/matrix) складываются в одну матрицу, центр текста (text-anchor:middle,
# alignment-baseline:central) переводится из координат viewBox в пиксели PNG.
_SVG_NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"


def _svg_parse_transform(t):
    """transform="..." → матрица (a, b, c, d, e, f) как в SVG."""
    m = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    for name, args in re.findall(r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)", t or ""):
        v = [float(x) for x in re.findall(_SVG_NUM, args)]
        if name == "matrix" and len(v) == 6:
            n = tuple(v)
        elif name == "translate":
            n = (1, 0, 0, 1, v[0] if v else 0.0, v[1] if len(v) > 1 else 0.0)
        elif name == "scale":
            sx = v[0] if v else 1.0
            n = (sx, 0, 0, v[1] if len(v) > 1 else sx, 0, 0)
        elif name == "rotate":
            a = math.radians(v[0] if v else 0.0)
            ca, sa = math.cos(a), math.sin(a)
            n = (ca, sa, -sa, ca, 0, 0)
            if len(v) >= 3:
                cx, cy = v[1], v[2]
                n = _svg_mul((1, 0, 0, 1, cx, cy), _svg_mul(n, (1, 0, 0, 1, -cx, -cy)))
        elif name == "skewX":
            n = (1, 0, math.tan(math.radians(v[0] if v else 0.0)), 1, 0, 0)
        else:
            n = (1, math.tan(math.radians(v[0] if v else 0.0)), 0, 1, 0, 0)
        m = _svg_mul(m, n)
    return m


def _svg_mul(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D,
            a * E + c * F + e, b * E + d * F + f)


def plan_svg_labels(svg_text, png_w, png_h):
    """Подписи комнат/размеров из SVG плана Zillow в пикселях PNG того же плана.
    → [{text, kind: 'name'|'dim', x, y, size, angle, w}] (формат l.labels в index.html)
    или [] (не тот этаж по пропорциям, нет viewBox, битый SVG)."""
    try:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(svg_text)
    except Exception:
        return []
    vb = [float(x) for x in re.findall(_SVG_NUM, root.get("viewBox") or "")]
    if len(vb) != 4 or vb[2] <= 0 or vb[3] <= 0 or not png_w or not png_h:
        return []
    if abs(vb[2] / vb[3] - png_w / png_h) > 0.01 * (png_w / png_h):
        return []   # пропорции не совпали — это SVG другого этажа
    kx, ky = png_w / vb[2], png_h / vb[3]
    out = []

    def local(tag):
        return tag.rsplit("}", 1)[-1]

    def walk(el, m, in_fix, in_dim):
        tag = local(el.tag)
        if tag in ("script", "style", "defs", "foreignObject"):
            return
        m = _svg_mul(m, _svg_parse_transform(el.get("transform")))
        cls = (el.get("class") or "").split()
        in_fix = in_fix or el.get("id") == "fixtures"
        in_dim = in_dim or "dimensionLabel" in cls
        if tag == "text":
            if in_fix:
                return
            txt = " ".join("".join(el.itertext()).split())
            if not txt:
                return
            fs = 0.0
            mm = re.search(r"font-size\s*:\s*(" + _SVG_NUM + ")", el.get("style") or "")
            if mm:
                fs = float(mm.group(1))
            elif el.get("font-size"):
                try:
                    fs = float(re.findall(_SVG_NUM, el.get("font-size"))[0])
                except Exception:
                    fs = 0.0
            tx = float((re.findall(_SVG_NUM, el.get("x") or "0") or ["0"])[0])
            ty = float((re.findall(_SVG_NUM, el.get("y") or "0") or ["0"])[0])
            a, b, c, d, e, f = m
            X = (a * tx + c * ty + e - vb[0]) * kx
            Y = (b * tx + d * ty + f - vb[1]) * ky
            ang = math.degrees(math.atan2(b * ky, a * kx))
            size = fs * math.hypot(a * kx, b * ky)
            if not (math.isfinite(X) and math.isfinite(Y)) or size <= 0:
                return
            out.append({"text": txt, "kind": "dim" if in_dim else "name",
                        "x": round(X, 1), "y": round(Y, 1), "size": round(size, 2),
                        "angle": int(round(ang)), "w": round(len(txt) * size * 0.56, 1)})
            return
        for ch in el:
            walk(ch, m, in_fix, in_dim)

    walk(root, (1.0, 0.0, 0.0, 1.0, 0.0, 0.0), False, False)
    return out


def merge_floor_plans(plans):
    """Складывает комнаты нескольких SVG-планов, НЕ считая один и тот же этаж
    дважды. Один этаж может лежать в архиве в двух копиях с РАЗНЫМИ id
    заметок (план карточки объявления и план тура строятся Zillow отдельно),
    поэтому копии сравниваются не только по id, но и по содержимому — набору
    пар «название + размеры». Если ≥60% комнат плана уже есть в учтённом
    плане — это копия того же этажа, она пропускается.
    plans: [(имя, {id: (label, dims)})] → (rooms {id: label}, отчёт [(имя, n, 'учтён'|'копия …')])"""
    kept, report, rooms = [], [], {}
    ordered = sorted(plans, key=lambda p: -len(p[1]))
    for name, pr in ordered:
        if not pr:
            report.append((name, 0, "пусто"))
            continue
        ids = set(pr)
        sig = [(l.lower(), d) for l, d in pr.values()]
        dup_of = None
        for kname, kpr in kept:
            kids = set(kpr)
            if len(ids & kids) >= 0.6 * len(ids):
                dup_of = kname
                break
            ksig = [(l.lower(), d) for l, d in kpr.values()]
            pool = list(ksig)
            hit = 0
            for s_ in sig:
                if s_ in pool:
                    pool.remove(s_)
                    hit += 1
            if hit >= 0.6 * len(sig):
                dup_of = kname
                break
        if dup_of:
            report.append((name, len(pr), f"копия этажа из {dup_of} — не считаю"))
            continue
        kept.append((name, pr))
        for k, (l, d) in pr.items():
            rooms[k] = l
        report.append((name, len(pr), "учтён"))
    return rooms, report


def collect_plan_svg_urls(obj, max_nodes=200000):
    """Ссылки на SVG-планы этажей в данных Zillow (richMedia.visualizations[].svg,
    showcase.floors[].primarySvgSource и т.п.) → {floor_shape_id: [url, …]}."""
    urls = {}
    counter = [0]

    def walk(o):
        if counter[0] > max_nodes:
            return
        counter[0] += 1
        if isinstance(o, str):
            if ".svg" in o and "floor_shape/" in o and o.startswith("http"):
                m = re.search(r"floor_shape/([0-9a-fA-F]+)/", o)
                if m:
                    lst = urls.setdefault(m.group(1).lower(), [])
                    if o not in lst:
                        lst.append(o)
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(obj)
    return urls


def run_download_batch(tasks, cookies_header, referer, log_fn,
                        max_workers=MAX_WORKERS, retries=DOWNLOAD_RETRIES,
                        retry_delay=RETRY_DELAY_SEC):
    """Скачивает список DownloadTask пулом потоков. Всё, что не скачалось
    с первого прохода, автоматически повторяется ещё до `retries` раз
    (с паузой между попытками) — реализует требование «докачать в конце
    первого цикла то, что почему-то не скачалось». Возвращает список задач,
    которые так и остались неудачными после всех попыток."""
    pending = [t for t in tasks if t is not None]
    if not pending:
        return []

    for attempt in range(retries + 1):
        if not pending:
            break
        if attempt == 0:
            log_fn(f"[скачивание] {len(pending)} файлов, до {max_workers} потоков одновременно...")
        else:
            log_fn(
                f"[скачивание][повтор {attempt}/{retries}] не скачалось {len(pending)} — "
                f"жду {retry_delay:.0f} сек и пробую снова"
            )
            time.sleep(retry_delay)

        workers = max(1, min(max_workers, len(pending)))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            future_to_task = {
                pool.submit(download_file, t.url, t.path, cookies_header, referer, log_fn): t
                for t in pending
            }
            for fut in concurrent.futures.as_completed(future_to_task):
                t = future_to_task[fut]
                try:
                    t.success = bool(fut.result())
                except Exception as e:
                    t.success = False
                    log_fn(f"[скачивание] исключение при загрузке {t.url}: {e}")
        pending = [t for t in pending if not t.success]

    if pending:
        names = ", ".join(t.label or t.url for t in pending[:10])
        more = " ..." if len(pending) > 10 else ""
        log_fn(f"[скачивание] так и не скачалось {len(pending)} файлов (после {retries} повторов): {names}{more}")
    return pending



# ---------------------------------------------------------------------
# Раунд 56: «Liquid Glass»-виджеты для Tk (macOS-стиль)
# ---------------------------------------------------------------------
# Tk не умеет настоящее размытие/преломление фона, поэтому стекло
# имитируется так, как его рисует Apple на светлом фоне: скруглённое тело,
# светлая «линза» в верхней половине, белый блик по верхней кромке, мягкая
# тень снизу и живой блик, который плывёт за курсором при наведении.

import tkinter.font as tkfont


def _hex(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _mix(c1, c2, t):
    a, b = _hex(c1), _hex(c2)
    return "#%02x%02x%02x" % tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def _rr_points(x1, y1, x2, y2, r):
    r = max(0.0, min(r, (x2 - x1) / 2.0, (y2 - y1) / 2.0))
    return [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
            x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]


def _rrect(cv, x1, y1, x2, y2, r, **kw):
    return cv.create_polygon(_rr_points(x1, y1, x2, y2, r), smooth=True, splinesteps=24, **kw)


class GlassCard(tk.Canvas):
    """Скруглённая стеклянная карточка. Содержимое — в self.inner."""

    def __init__(self, parent, bg_outer, fill=None, edge=None, radius=20, pad=(18, 16),
                 fill_height=False, dark=False):
        super().__init__(parent, bg=bg_outer, highlightthickness=0, bd=0, height=40)
        self.bg_outer, self.radius, self.pad = bg_outer, radius, pad
        self.fill = fill or GLASS
        self.edge = edge or GLASS_EDGE
        self.dark = dark
        self.fill_height = fill_height
        self.inner = tk.Frame(self, bg=self.fill, bd=0, highlightthickness=0)
        self._win = self.create_window(pad[0], pad[1] + 1, window=self.inner, anchor="nw")
        self.bind("<Configure>", lambda e: self._redraw())
        if not fill_height:
            self.inner.bind("<Configure>", lambda e: self._fit_height())

    def _fit_height(self):
        h = self.inner.winfo_reqheight() + self.pad[1] * 2 + 6
        if int(self.cget("height")) != h:
            self.configure(height=h)

    def _redraw(self):
        w, h = self.winfo_width(), self.winfo_height()
        if w < 10 or h < 10:
            return
        self.delete("bg")
        r = self.radius
        # мягкая тень: несколько слоёв с растущим радиусом
        for i, t in enumerate((0.035, 0.05, 0.07)):
            off = 3 - i
            _rrect(self, 1 + off, 2 + off * 1.5, w - 1 - off, h - 1, r + off,
                   fill=_mix(self.bg_outer, "#000000", t), outline="", tags="bg")
        _rrect(self, 1, 1, w - 2, h - 5, r, fill=self.fill, outline=self.edge, width=1, tags="bg")
        # блик по верхней кромке — главный признак «стекла»
        rim = "#ffffff" if not (self.dark or THEME_DARK) else _mix(self.fill, "#ffffff", 0.14)
        self.create_line(r * 0.8, 2, w - r * 0.8, 2, fill=rim, width=1, tags="bg")
        self.tag_lower("bg")
        self.itemconfigure(self._win, width=max(10, w - self.pad[0] * 2))
        if self.fill_height:
            self.itemconfigure(self._win, height=max(10, h - self.pad[1] * 2 - 6))


class GlassButton(tk.Canvas):
    """Кнопка-пилюля: kind = primary | glass | icon. Живой блик под курсором,
    «вдавливание» при нажатии. Поддерживает config(state=..., text=...)."""

    def __init__(self, parent, text="", command=None, kind="glass", bg_outer=None, icon=None,
                 height=34, font=None, tooltip=None, padx=18):
        self._bg = bg_outer or GLASS
        super().__init__(parent, bg=self._bg, highlightthickness=0, bd=0, height=height,
                         cursor="pointinghand" if _IS_MAC else "hand2")
        self._text, self._cmd, self._kind, self._icon = text, command, kind, icon
        self._font = font or (FONT_UI[0], FONT_UI[1], "bold") if kind == "primary" else (font or FONT_UI)
        self._h, self._padx = height, padx
        self._state, self._hover, self._press, self._mx = "normal", False, False, None
        self._badge = None
        self._resize()
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Motion>", self._on_motion)
        self.bind("<ButtonPress-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)
        if tooltip:
            Tooltip(self, tooltip)

    def _resize(self):
        if self._kind == "icon":
            w = self._h + (18 if self._badge else 0)
        else:
            f = tkfont.Font(font=self._font)
            w = f.measure(self._text) + self._padx * 2 + (18 if self._icon else 0)
        super().configure(width=w)
        self._bw = w
        self._draw()

    def configure(self, cnf=None, **kw):
        if isinstance(cnf, dict):
            kw.update(cnf)
            cnf = None
        redraw = False
        if "state" in kw:
            self._state = str(kw.pop("state"))
            redraw = True
        if "text" in kw:
            self._text = kw.pop("text")
            self._resize()
        if "command" in kw:
            self._cmd = kw.pop("command")
        if kw or cnf:
            r = super().configure(cnf, **kw)
        else:
            r = None
        if redraw:
            self._draw()
        return r

    config = configure

    def set_badge(self, n):
        self._badge = n or None
        self._resize()

    def _colors(self):
        dis = self._state == "disabled"
        if self._kind == "primary":
            base = ACCENT_DISABLED if dis else (ACCENT_DARK if self._press else ACCENT)
            fg = "#ffffff"
            lens = _mix(base, "#ffffff", 0.22)
            glow = _mix(base, "#ffffff", 0.35)
            edge = _mix(base, "#000000", 0.12)
        else:
            base = BTN_BG if not self._press else BTN_PRESSED
            if self._hover and not dis and not self._press:
                base = BTN_HOVER
            fg = MUTED if dis else TEXT
            lens = _mix(base, "#ffffff", 0.08 if THEME_DARK else 0.55)
            glow = _mix(base, "#ffffff", 0.25) if THEME_DARK else "#ffffff"
            edge = _mix(base, "#000000", 0.06)
        return base, lens, glow, edge, fg

    def _draw(self):
        self.delete("all")
        w, h = self._bw, self._h
        base, lens, glow, edge, fg = self._colors()
        r = h / 2.0
        _rrect(self, 1, 1, w - 1, h - 1, r, fill=base, outline=edge)
        # «линза» — светлая верхняя половина стекла
        _rrect(self, 3, 2, w - 3, h * 0.55, r - 2, fill=lens, outline="")
        # живой блик под курсором
        if self._hover and self._mx is not None and self._state != "disabled":
            x = min(max(self._mx, r), w - r)
            rr = r * 0.78
            for k, t in ((1.0, 0.25), (0.7, 0.45), (0.42, 0.65)):
                self.create_oval(x - rr * k * 1.6, h / 2 - rr * k, x + rr * k * 1.6, h / 2 + rr * k,
                                 fill=_mix(base, glow, t), outline="")
        rim = lens if (self._kind == "primary" or THEME_DARK) else "#ffffff"
        self.create_line(r, 2, w - r, 2, fill=_mix(rim, "#ffffff", 0.1) if THEME_DARK else rim)
        dy = 1 if self._press else 0
        if self._kind == "icon":
            self._draw_icon(h / 2.0, h / 2.0 + dy, fg)
            if self._badge:
                self.create_text(h + 5, h / 2.0 + dy, text=str(self._badge), fill=fg, font=FONT_UI, anchor="w")
        else:
            tx = w / 2.0 + (9 if self._icon else 0)
            self.create_text(tx, h / 2.0 + dy, text=self._text, fill=fg, font=self._font)

    def _draw_icon(self, cx, cy, fg):
        if self._icon == "trash":
            s = self._h / 34.0
            c = ERR_COLOR if (self._state != "disabled" and self._hover) else fg
            self.create_line(cx - 7 * s, cy - 6 * s, cx + 7 * s, cy - 6 * s, fill=c, width=1.6 * s, capstyle="round")
            self.create_line(cx - 2.5 * s, cy - 8.5 * s, cx + 2.5 * s, cy - 8.5 * s, fill=c, width=1.6 * s, capstyle="round")
            self.create_polygon(cx - 5.5 * s, cy - 4 * s, cx + 5.5 * s, cy - 4 * s, cx + 4.3 * s, cy + 8 * s,
                                cx - 4.3 * s, cy + 8 * s, fill="", outline=c, width=1.6 * s, joinstyle="round")
            for dx in (-2, 0, 2):
                self.create_line(cx + dx * s, cy - 1.5 * s, cx + dx * s, cy + 5.5 * s, fill=c, width=1.1 * s)

    def _on_enter(self, e):
        self._hover, self._mx = True, e.x
        self._draw()

    def _on_leave(self, e):
        self._hover = self._press = False
        self._draw()

    def _on_motion(self, e):
        self._mx = e.x
        if self._hover:
            self._draw()

    def _on_press(self, e):
        if self._state == "disabled":
            return
        self._press = True
        self._draw()

    def _on_release(self, e):
        if self._state == "disabled":
            return
        was = self._press
        self._press = False
        self._draw()
        if was and 0 <= e.x <= self._bw and 0 <= e.y <= self._h and self._cmd:
            self._cmd()


class GlassField(tk.Canvas):
    """Скруглённое поле ввода с синим кольцом фокуса. Внутри — tk.Entry (self.entry)."""

    def __init__(self, parent, bg_outer, textvariable=None, height=38, font=None, mono=False):
        super().__init__(parent, bg=bg_outer, highlightthickness=0, bd=0, height=height)
        self._h, self._focus = height, False
        self.entry = tk.Entry(self, relief="flat", bd=0, highlightthickness=0, bg=FIELD_BG, fg=TEXT,
                              insertbackground=ACCENT, font=font or FONT_UI,
                              textvariable=textvariable, selectbackground=SELECT_BG, selectforeground=TEXT)
        self._win = self.create_window(14, height / 2.0, window=self.entry, anchor="w")
        self.bind("<Configure>", lambda e: self._draw())
        self.bind("<Button-1>", lambda e: self.entry.focus_set())
        self.entry.bind("<FocusIn>", lambda e: self._set_focus(True), add="+")
        self.entry.bind("<FocusOut>", lambda e: self._set_focus(False), add="+")

    def _set_focus(self, v):
        self._focus = v
        self._draw()

    def _draw(self):
        w, h = self.winfo_width(), self._h
        if w < 10:
            return
        self.delete("bg")
        r = h / 2.0 - 4
        if self._focus:
            _rrect(self, 0, 0, w, h, r + 3, fill=_mix(ACCENT, self["bg"], 0.72), outline="", tags="bg")
        _rrect(self, 2, 2, w - 2, h - 2, r, fill=FIELD_BG,
               outline=ACCENT if self._focus else BORDER, width=1.5 if self._focus else 1, tags="bg")
        self.tag_lower("bg")
        self.itemconfigure(self._win, width=max(10, w - 28))


class GlassSwitch(tk.Canvas):
    """Переключатель в стиле macOS с плавно «перетекающей» ручкой."""

    def __init__(self, parent, variable, bg_outer, command=None):
        super().__init__(parent, bg=bg_outer, highlightthickness=0, bd=0, width=42, height=24,
                         cursor="pointinghand" if _IS_MAC else "hand2")
        self.var, self._cmd = variable, command
        self._pos = 1.0 if variable.get() else 0.0
        self._anim = None
        self.bind("<ButtonRelease-1>", lambda e: self.toggle())
        try:  # программная смена значения тоже двигает ручку
            variable.trace_add("write", lambda *a: self._animate())
        except Exception:
            pass
        self._draw()

    def toggle(self):
        self.var.set(not self.var.get())
        if self._cmd:
            self._cmd()

    def _animate(self):
        target = 1.0 if self.var.get() else 0.0
        if self._anim:
            self.after_cancel(self._anim)

        def step():
            d = target - self._pos
            if abs(d) < 0.04:
                self._pos = target
                self._draw()
                self._anim = None
                return
            self._pos += d * 0.35
            self._draw()
            self._anim = self.after(16, step)

        step()

    def _draw(self):
        self.delete("all")
        w, h = 42, 24
        track = _mix(TRACK_OFF, ACCENT, self._pos)
        _rrect(self, 1, 1, w - 1, h - 1, h / 2.0, fill=track, outline="")
        x = 2 + (w - h) * self._pos
        _rrect(self, x + 1, 3.5, x + h - 3, h - 0.5, (h - 4) / 2.0, fill=_mix(track, "#000000", 0.18), outline="")
        # ручка чуть «растягивается» в движении — жидкое стекло
        stretch = 4 * (1 - abs(self._pos - 0.5) * 2) if 0 < self._pos < 1 else 0
        _rrect(self, x + 1 - stretch / 2, 2, x + h - 3 + stretch / 2, h - 2, (h - 4) / 2.0,
               fill="#ffffff", outline="")


class GlassProgress(tk.Canvas):
    """Тонкий скруглённый индикатор с «переливом» (неопределённый режим).
    API как у ttk.Progressbar: start(interval_ms) / stop()."""

    def __init__(self, parent, bg_outer, height=6):
        super().__init__(parent, bg=bg_outer, highlightthickness=0, bd=0, height=height)
        self._h, self._t, self._job = height, 0.0, None
        self.bind("<Configure>", lambda e: self._draw())

    def start(self, interval=12):
        self.stop()
        self._interval = max(10, int(interval) + 4)

        def tick():
            self._t = (self._t + 0.012) % 1.0
            self._draw()
            self._job = self.after(self._interval, tick)

        tick()

    def stop(self):
        if self._job:
            self.after_cancel(self._job)
            self._job = None
        self._t = 0.0
        self._draw()

    def _draw(self):
        self.delete("all")
        w, h = self.winfo_width(), self._h
        if w < 10:
            return
        _rrect(self, 0, 0, w, h, h / 2.0, fill=TRACK, outline="")
        if self._job:
            seg = w * 0.28
            x = -seg + (w + seg) * self._t
            x1, x2 = max(0, x), min(w, x + seg)
            if x2 - x1 > h:
                _rrect(self, x1, 0, x2, h, h / 2.0, fill=ACCENT, outline="")
                _rrect(self, x1 + 2, 1, x2 - 2, h / 2.0, h / 4.0, fill=_mix(ACCENT, "#ffffff", 0.35), outline="")


class Tooltip:
    """Подсказка при наведении (полный старый текст подписи)."""

    def __init__(self, widget, text, delay=450):
        self.w, self.text, self.delay, self.tip, self.job = widget, text, delay, None, None
        widget.bind("<Enter>", self._sched, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def _sched(self, e=None):
        self._hide()
        self.job = self.w.after(self.delay, self._show)

    def _show(self):
        try:
            x = self.w.winfo_rootx() + 8
            y = self.w.winfo_rooty() + self.w.winfo_height() + 6
            self.tip = tk.Toplevel(self.w)
            self.tip.wm_overrideredirect(True)
            self.tip.wm_geometry(f"+{x}+{y}")
            tk.Label(self.tip, text=self.text, bg="#2c2c2e", fg="#f5f5f7", font=FONT_SMALL,
                     padx=10, pady=6, justify="left", wraplength=460).pack()
        except Exception:
            self.tip = None

    def _hide(self, e=None):
        if self.job:
            try:
                self.w.after_cancel(self.job)
            except Exception:
                pass
            self.job = None
        if self.tip:
            try:
                self.tip.destroy()
            except Exception:
                pass
            self.tip = None



class QueueItem:
    STATUS_PENDING = "Ожидание"
    STATUS_RUNNING = "Загружается…"
    STATUS_DONE = "Готово"
    STATUS_ERROR = "Ошибка"

    __slots__ = (
        "index", "url", "status", "result_path", "error", "platform", "iid",
        "fl_count", "r_count", "p_count",
    )

    def __init__(self, index, url):
        self.index = index
        self.url = url
        self.status = QueueItem.STATUS_PENDING
        self.result_path = None
        self.error = None
        self.platform = None
        self.iid = None
        # Доп. свойства элемента очереди для показа в таблице — заполняются
        # после того, как для ссылки удалось определить платформу и извлечь
        # данные тура (см. GrabberApp._set_queue_item_meta).
        self.fl_count = None
        self.r_count = None
        self.p_count = None


class GrabberApp:
    def __init__(self, root):
        self.root = root
        self.root.title(f"3D Tour Grabber — сборка {GRABBER_VERSION_SHORT}")
        self.root.geometry("1080x860")
        self.root.minsize(760, 580)
        self.root.configure(bg=BG)

        self.log_lock = threading.Lock()
        self.queue_lock = threading.Lock()
        self.playwright = None
        self.browser = None
        self._chrome_proc = None
        self._cookies_header = ""
        self._referer = ""
        self._original_url = ""
        self._log_fh = None
        # План этажа с карточки объявления (раздел «Floor plan»):
        # URL-ы + уже скачанные имена файлов внутри ARCHIVE_DIR.
        # Заполняется ДО открытия 3D-тура и скачивания панорам.
        self._listing_floor_plan_urls = []
        self._listing_floor_plan_files = []
        # Если данные тура удалось поймать напрямую из сетевого ответа
        # (см. _start_network_richmedia_watch) — richMedia-словарь
        # кладётся сюда, и _run_single обрабатывает его сразу, не дожидаясь
        # window.__NEXT_DATA__ ни в одном фрейме.
        self._captured_rich_media_from_network = None
        self._network_watch_page = None
        self._network_watch_handler = None
        self._debug_capture_count = 0

        self.queue_items = []
        self._processing = False

        # Шаблон имени файла результата, зафиксированный на момент нажатия
        # «Старт» (см. start()) — используется потом из фонового потока
        # вместо чтения tk.StringVar напрямую из не-главного потока.
        self._active_name_template = DEFAULT_NAME_TEMPLATE

        self._reset_archive()
        _st = _load_settings()
        _apply_theme_globals(_st["theme"] == "dark" if _st.get("theme") in ("dark", "light")
                             else _system_prefers_dark())
        self._status_kind = "info"
        self._build_style()
        self._build_ui()
        self._setup_translucency()

    # ---------- оформление ----------

    def _build_style(self):
        """Раунд 56: ttk-часть оформления (таблица очереди); всё остальное —
        собственные стеклянные виджеты (GlassCard/GlassButton/...)."""
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure(".", font=FONT_UI, foreground=TEXT)
        style.configure("App.TFrame", background=BG)
        style.configure("Accent.TButton", background=ACCENT, foreground=ACCENT_TEXT,
                        font=(FONT_UI[0], FONT_UI[1], "bold"), padding=(16, 8), borderwidth=0,
                        lightcolor=ACCENT, darkcolor=ACCENT, bordercolor=ACCENT)
        style.map("Accent.TButton", background=[("active", ACCENT_HOVER)])
        style.configure("Treeview", font=FONT_UI, rowheight=32, fieldbackground=GLASS, background=GLASS,
                        foreground=TEXT, borderwidth=0, relief="flat")
        style.map("Treeview", background=[("selected", SELECT_BG)], foreground=[("selected", TEXT)])
        style.configure("Treeview.Heading", font=FONT_SMALL, background=GLASS, foreground=MUTED,
                        borderwidth=0, relief="flat", padding=(6, 4))
        style.map("Treeview.Heading", background=[("active", GLASS)])
        try:
            style.layout("Treeview", [("Treeview.treearea", {"sticky": "nswe"})])
        except Exception:
            pass

    # подписи внутри карточек
    def _lbl(self, parent, text, kind="field", tooltip=None):
        font = {"field": FONT_SMALL, "section": (FONT_UI[0], FONT_UI[1], "bold")}.get(kind, FONT_UI)
        fg = MUTED if kind == "field" else TEXT
        w = tk.Label(parent, text=text, bg=parent["bg"], fg=fg, font=font, bd=0)
        if tooltip:
            Tooltip(w, tooltip)
        return w

    def _build_ui(self):
        self.root.configure(bg=BG)
        # ---- строка статуса — ДО тела (иначе растянутое тело её закрывает)
        status_bar = tk.Frame(self.root, bg=BG)
        status_bar.pack(fill="x", side="bottom")
        self.status_var = tk.StringVar(value="Добавьте ссылку(и) в очередь и нажмите «Старт»")
        self.status_label = tk.Label(status_bar, textvariable=self.status_var, bg=BG, fg=MUTED,
                                     font=FONT_SMALL, anchor="w", padx=26, pady=8)
        self.status_label.pack(fill="x")

        # ---- заголовок: «3D Tour Grabber (Zillow, Matterport)»
        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=26, pady=(20, 10))
        tk.Label(header, text="3D Tour Grabber", bg=BG, fg=TEXT, font=FONT_TITLE).pack(side="left")
        sub = tk.Label(header, text="(Zillow, Matterport)", bg=BG, fg=MUTED,
                       font=(FONT_TITLE[0], max(12, FONT_TITLE[1] - 6)))
        sub.pack(side="left", padx=(8, 0), pady=(5, 0))
        Tooltip(sub, "Zillow и Matterport — без кликов, платформа определяется автоматически. "
                     "Можно поставить в очередь сразу несколько ссылок.")
        self.theme_btn = GlassButton(header, "☾  Тёмная" if not THEME_DARK else "☀  Светлая",
                                     command=self._toggle_theme, bg_outer=BG, height=30, padx=14,
                                     tooltip="Переключить тему: светлая / тёмная")
        self.theme_btn.pack(side="right", pady=(4, 0))
        tk.Label(header, text=f"сборка {GRABBER_VERSION_SHORT}", bg=BG, fg=MUTED,
                 font=FONT_SMALL).pack(side="right", pady=(8, 0), padx=(0, 12))

        body = tk.Frame(self.root, bg=BG)
        body.pack(fill="both", expand=True, padx=20, pady=(0, 4))

        # ---- карточка ввода
        c1 = GlassCard(body, BG)
        c1.pack(fill="x", pady=(0, 12))
        inn = c1.inner
        self._lbl(inn, "Ссылки на тур", tooltip="Ссылка(и) на тур — можно вставить сразу несколько "
                                                "через пробел/запятую/новую строку").pack(anchor="w", padx=4)
        row = tk.Frame(inn, bg=GLASS)
        row.pack(fill="x", pady=(6, 12))
        url_field = GlassField(row, GLASS)
        url_field.pack(side="left", fill="x", expand=True)
        self.url_entry = url_field.entry
        self.url_entry.bind("<Return>", lambda e: self._add_links())
        self.add_btn = GlassButton(row, "+  Добавить", command=self._add_links, kind="primary",
                                   bg_outer=GLASS, height=38, tooltip="Добавить в очередь")
        self.add_btn.pack(side="left", padx=(10, 0))
        self.file_btn = GlassButton(row, "Из файла…", command=self._load_links_from_file, kind="glass",
                                    bg_outer=GLASS, height=38,
                                    tooltip="Загрузить список ссылок из текстового файла (.txt, .csv — "
                                            "по одной или несколько в строке)")
        self.file_btn.pack(side="left", padx=(8, 0))

        self._lbl(inn, "Шаблон имени", tooltip="Шаблон имени файла результата — обрабатывается как "
                                               "f-строка Python (любые выражения и форматы внутри {...})"
                  ).pack(anchor="w", padx=4)
        name_row = tk.Frame(inn, bg=GLASS)
        name_row.pack(fill="x", pady=(6, 0))
        self.name_template_var = tk.StringVar(value=DEFAULT_NAME_TEMPLATE)
        name_field = GlassField(name_row, GLASS, textvariable=self.name_template_var, font=FONT_MONO_UI)
        name_field.pack(side="left", fill="x", expand=True)
        self.name_template_entry = name_field.entry
        self.vars_btn = GlassButton(name_row, "Переменные", command=self._show_template_help,
                                    bg_outer=GLASS, height=38, tooltip="Переменные шаблона имени")
        self.vars_btn.pack(side="left", padx=(10, 0))

        # всплывающий блок переменных — прямо под полем шаблона
        self._vars_host = tk.Frame(inn, bg=GLASS)
        self._vars_host.pack(fill="x")
        self._vars_panel = None

        sw_row = tk.Frame(inn, bg=GLASS)
        sw_row.pack(fill="x", pady=(14, 0))
        self.show_hidden_var = tk.BooleanVar(value=False)
        GlassSwitch(sw_row, self.show_hidden_var, GLASS).pack(side="left", padx=(2, 10))
        self._lbl(sw_row, "Рисовать скрытые панорамы на PNG-планах", kind="body",
                  tooltip="Показать скрытые камеры (улица/балконы — оранжевые контуры, "
                          "Zillow их на плане не ставит)").pack(side="left")

        # ---- карточка очереди
        c2 = GlassCard(body, BG)
        c2.pack(fill="x", pady=(0, 12))
        q = c2.inner
        qh = tk.Frame(q, bg=GLASS)
        qh.pack(fill="x", pady=(0, 8))
        self._lbl(qh, "Очередь загрузки", kind="section").pack(side="left", padx=4)
        GlassButton(qh, "Очистить очередь", command=self._clear_queue, bg_outer=GLASS).pack(side="right")
        self.trash_btn = GlassButton(qh, kind="icon", icon="trash", command=self._remove_selected,
                                     bg_outer=GLASS, tooltip="Удалить выбранные ссылки (⌫)")
        self.trash_btn.pack(side="right", padx=(0, 8))
        self.trash_btn.config(state="disabled")

        self.tree = ttk.Treeview(
            q, columns=("n", "url", "platform", "floors", "rooms", "panoramas", "status"),
            show="headings", height=4, selectmode="extended",
        )
        for col, txt in (("n", "#"), ("url", "Ссылка"), ("platform", "Платформа"), ("floors", "Этажи"),
                         ("rooms", "Комнаты"), ("panoramas", "Панорамы"), ("status", "Статус")):
            self.tree.heading(col, text=txt, anchor="w" if col == "url" else "center")
        self.tree.column("n", width=36, anchor="center", stretch=False)
        self.tree.column("url", width=420, anchor="w")
        self.tree.column("platform", width=96, anchor="center", stretch=False)
        self.tree.column("floors", width=64, anchor="center", stretch=False)
        self.tree.column("rooms", width=80, anchor="center", stretch=False)
        self.tree.column("panoramas", width=90, anchor="center", stretch=False)
        self.tree.column("status", width=130, anchor="center", stretch=False)
        self.tree.pack(fill="x")
        # выделение: клик по строке включает/выключает её (без модификаторов),
        # ⌘A / Ctrl+A — все, ⌫ / Delete — удалить выбранные
        self.tree.bind("<Button-1>", self._tree_click)
        self.tree.bind("<<TreeviewSelect>>", lambda e: self._sync_trash())
        for seq in ("<BackSpace>", "<Delete>"):
            self.tree.bind(seq, lambda e: (self._remove_selected(), "break")[1])
        for seq in ("<Command-a>", "<Control-a>"):
            try:
                self.tree.bind(seq, lambda e: (self.tree.selection_set(self.tree.get_children()), "break")[1])
            except tk.TclError:
                pass

        # ---- старт + тонкий «переливающийся» прогресс
        act = tk.Frame(body, bg=BG)
        act.pack(fill="x", pady=(0, 12))
        self.start_btn = GlassButton(act, "▶  Старт — скачать всю очередь", command=self.start,
                                     kind="primary", bg_outer=BG, height=40, padx=22)
        self.start_btn.pack(side="left")
        self.progress = GlassProgress(act, BG)
        self.progress.pack(side="left", fill="x", expand=True, padx=(18, 4))

        # ---- журнал: тёмное стекло
        c3 = GlassCard(body, BG, fill=LOG_BG, edge=LOG_BORDER, fill_height=True, dark=True, pad=(16, 12))
        c3.pack(fill="both", expand=True, pady=(0, 8))
        self.log = tk.Text(
            c3.inner, state="disabled", bg=LOG_BG, fg=LOG_FG, insertbackground=LOG_FG, font=FONT_MONO,
            relief="flat", bd=0, highlightthickness=0, padx=4, pady=2, wrap="word",
            selectbackground="#3a3a3c",
        )
        self.log.pack(fill="both", expand=True)

    # ---------- выделение в очереди ----------

    def _tree_click(self, e):
        if self.tree.identify_region(e.x, e.y) == "heading":
            return None
        iid = self.tree.identify_row(e.y)
        self.tree.focus_set()
        if not iid:
            self.tree.selection_remove(self.tree.selection())
        elif iid in self.tree.selection():
            self.tree.selection_remove(iid)
        else:
            self.tree.selection_add(iid)
        self._sync_trash()
        return "break"

    def _sync_trash(self):
        n = len(self.tree.selection())
        try:
            self.trash_btn.set_badge(n if n else None)
            self.trash_btn.config(state="normal" if n and not self._processing else "disabled")
        except Exception:
            pass

    # ---------- всплывающий блок переменных шаблона ----------

    TEMPLATE_VARS = (
        ("fl_count", "этажи"), ("r_count", "комнаты"), ("p_count", "панорамы"),
        ("platform", "zillow / matterport"), ("address", "адрес"), ("model_name", "название"),
        ("zpid", "ZPID Zillow"), ("lot_sqft", "участок, sqft"), ("lot_m2", "участок, м²"),
        ("source_url", "ссылка"), ("date", "ГГГГ-ММ-ДД"),
        ("time", "ЧЧ-ММ-СС"), ("datetime", "дата и время"), ("index", "№ в очереди"),
        ("total", "всего в очереди"),
    )

    def _show_template_help(self):
        """Раунд 56: вместо окна-сообщения — стеклянный блок под полем шаблона.
        Клик по переменной вставляет {имя} в позицию курсора."""
        if self._vars_panel is not None:
            self._vars_panel.destroy()
            self._vars_panel = None
            # баг 15.37: опустевший фрейм сохранял прежнюю высоту — сжимаем явно
            self._vars_host.configure(height=1)
            self.vars_btn.config(text="Переменные")
            return
        panel = GlassCard(self._vars_host, GLASS, fill=GLASS_INSET, edge=BORDER, radius=16, pad=(14, 12))
        panel.pack(fill="x", pady=(10, 0))
        grid = panel.inner
        cols = 3
        for i, (name, desc) in enumerate(self.TEMPLATE_VARS):
            cell = tk.Frame(grid, bg=GLASS_INSET)
            cell.grid(row=i // cols, column=i % cols, sticky="w", padx=(0, 18), pady=3)
            GlassButton(cell, "{" + name + "}", command=lambda n=name: self._insert_var(n),
                        bg_outer=GLASS_INSET, height=26, font=FONT_MONO_UI, padx=10).pack(side="left")
            tk.Label(cell, text=desc, bg=GLASS_INSET, fg=MUTED, font=FONT_SMALL).pack(side="left", padx=(6, 0))
        for c in range(cols):
            grid.grid_columnconfigure(c, weight=1)
        tk.Label(
            grid, bg=GLASS_INSET, fg=MUTED, font=FONT_SMALL, justify="left", anchor="w",
            text="f-строка Python: {fl_count:02d}, {address or 'noaddr'} · синонимы: floors, rooms, "
                 "panoramas · символы \\ / : * ? \" < > | → «_»",
        ).grid(row=len(self.TEMPLATE_VARS) // cols + 1, column=0, columnspan=cols, sticky="w", pady=(8, 0))
        self._vars_panel = panel
        self.vars_btn.config(text="Скрыть")

    def _insert_var(self, name):
        e = self.name_template_entry
        try:
            e.insert("insert", "{" + name + "}")
            e.focus_set()
        except Exception:
            pass

    # ---------- очередь ссылок ----------

    def _add_links(self):
        raw = self.url_entry.get().strip()
        if not raw:
            return
        candidates = [u for u in re.split(r"[\s,;]+", raw) if u]
        added = 0
        for u in candidates:
            if not u.lower().startswith("http"):
                continue
            self._add_queue_item(u)
            added += 1
        self.url_entry.delete(0, "end")
        if added:
            with self.queue_lock:
                total = len(self.queue_items)
            self._set_status(f"В очереди: {total} (добавлено {added})", kind="info")
        elif candidates:
            messagebox.showwarning("Не похоже на ссылку", "Введённый текст не похож на ссылку (http/https).")

    def _load_links_from_file(self):
        """Раунд 62: список ссылок из текстового файла. Берутся все http(s)-ссылки
        из любых мест файла (по одной в строке, через запятую, внутри CSV и т.п.);
        строки с # в начале — комментарии. Повторы (и уже стоящие в очереди)
        пропускаются."""
        path = filedialog.askopenfilename(
            title="Список ссылок",
            filetypes=[("Текст и сохранённые страницы", "*.txt *.csv *.tsv *.list *.md *.mhtml *.mht *.html *.htm"),
                       ("Все файлы", "*.*")],
        )
        if not path:
            return
        text = None
        for enc in ("utf-8-sig", "utf-16", "cp1251", "latin-1"):
            try:
                with open(path, "r", encoding=enc) as f:
                    text = f.read()
                break
            except Exception:
                continue
        if text is None:
            messagebox.showerror("Не удалось прочитать файл", path)
            return
        urls = []
        is_saved_page = (path.lower().endswith((".mhtml", ".mht", ".html", ".htm"))
                         or ("MIME-Version" in text[:4000] and "multipart/related" in text[:4000])
                         or text.lstrip()[:15].lower().startswith(("<!doctype", "<html")))
        if is_saved_page:
            urls, how = extract_tour_links_from_saved_page(text)
            self.log_msg(f"[очередь] сохранённая страница «{os.path.basename(path)}»: {how}, ссылок: {len(urls)}")
        else:
            for line in text.splitlines():
                if line.lstrip().startswith("#"):
                    continue
                for m in re.finditer(r"https?://[^\s,;\"'<>|]+", line):
                    u = normalize_tour_url(m.group(0).rstrip(").]}"))
                    urls.append(u)
        with self.queue_lock:
            existing = {it.url for it in self.queue_items}
        added = skipped = 0
        seen = set()
        for u in urls:
            if u in existing or u in seen:
                skipped += 1
                continue
            seen.add(u)
            self._add_queue_item(u)
            added += 1
        name = os.path.basename(path)
        self.log_msg(f"[очередь] из файла «{name}»: добавлено {added}, повторов пропущено {skipped}")
        if added:
            with self.queue_lock:
                total = len(self.queue_items)
            self._set_status(f"В очереди: {total} (из файла добавлено {added})", kind="info")
        else:
            messagebox.showwarning("Ссылок не найдено",
                                   f"В файле «{name}» нет новых ссылок http/https." +
                                   (f" Повторов пропущено: {skipped}." if skipped else ""))

    def _row_values(self, item):
        def fmt(v):
            return "—" if v is None else v

        return (
            item.index, item.url, fmt(item.platform),
            fmt(item.fl_count), fmt(item.r_count), fmt(item.p_count),
            item.status,
        )

    def _add_queue_item(self, url):
        norm = normalize_tour_url(url)
        if norm != url:
            try:
                self.log_msg(f"[очередь] ссылка Matterport приведена к адресу тура: {url[:90]} → {norm}")
            except Exception:
                pass
            url = norm
        with self.queue_lock:
            idx = len(self.queue_items) + 1
            item = QueueItem(idx, url)
            self.queue_items.append(item)
        item.iid = self.tree.insert("", "end", values=self._row_values(item))

    def _remove_selected(self):
        if self._processing:
            return
        sel = self.tree.selection()
        if not sel:
            return
        remove_iids = set(sel)
        with self.queue_lock:
            self.queue_items = [it for it in self.queue_items if it.iid not in remove_iids]
        for iid in sel:
            self.tree.delete(iid)
        self._renumber_queue()
        self._sync_trash()
        self._status_queue_count()

    def _clear_queue(self):
        if self._processing:
            return
        with self.queue_lock:
            self.queue_items = []
        for iid in self.tree.get_children():
            self.tree.delete(iid)
        self._sync_trash()
        self._status_queue_count()

    def _renumber_queue(self):
        with self.queue_lock:
            for i, it in enumerate(self.queue_items, start=1):
                it.index = i
                self.tree.item(it.iid, values=self._row_values(it))

    def _next_pending_item(self):
        with self.queue_lock:
            for it in self.queue_items:
                if it.status == QueueItem.STATUS_PENDING:
                    it.status = QueueItem.STATUS_RUNNING
                    return it
        return None

    def _set_queue_status(self, item, status):
        item.status = status

        def _u():
            try:
                self.tree.item(item.iid, values=self._row_values(item))
            except Exception:
                pass

        self.root.after(0, _u)

    def _set_queue_item_meta(self, item, platform, fl_count, r_count, p_count):
        """Заполняет доп. свойства элемента очереди (платформа, число
        этажей/комнат/панорам), как только они стали известны — это те же
        значения, что подставляются в шаблон имени файла."""
        item.platform = platform
        item.fl_count = fl_count
        item.r_count = r_count
        item.p_count = p_count

        def _u():
            try:
                self.tree.item(item.iid, values=self._row_values(item))
            except Exception:
                pass

        self.root.after(0, _u)

    # ---------- журнал / статус ----------

    def _reset_archive(self):
        # Закрываем предыдущий файловый хендл журнала (если был) — папка
        # arhive/ могла быть только что удалена после архивации прошлого
        # тура, так что журнал начинаем заново, но держим файл открытым
        # на запись вместо open()/close() на каждую строку — так быстрее.
        with self.log_lock:
            if self._log_fh:
                try:
                    self._log_fh.close()
                except Exception:
                    pass
                self._log_fh = None

        os.makedirs(ARCHIVE_DIR, exist_ok=True)
        is_new = not os.path.exists(DEBUG_LOG_PATH)
        try:
            self._log_fh = open(DEBUG_LOG_PATH, "a", encoding="utf-8")
            if is_new:
                self._log_fh.write(f"=== 3D Tour Grabber, сборка {GRABBER_VERSION} ===\n")
                self._log_fh.flush()
        except Exception:
            self._log_fh = None

    def _ts(self):
        return datetime.now().strftime("%H:%M:%S.%f")[:-3]

    def log_msg(self, text):
        try:
            self._px_guard_tick()
        except Exception:
            pass
        line = f"[{self._ts()}] {text}"
        with self.log_lock:
            try:
                if self._log_fh:
                    self._log_fh.write(line + "\n")
                    self._log_fh.flush()
            except Exception:
                pass

        def _u():
            self.log.configure(state="normal")
            self.log.insert("end", line + "\n")
            self.log.see("end")
            self.log.configure(state="disabled")

        if threading.current_thread() is threading.main_thread():
            _u()
        else:
            self.root.after(0, _u)

    def _status_queue_count(self):
        """Раунд 57: строка статуса отражает фактическую очередь после
        удаления/очистки (раньше показывала старое число)."""
        with self.queue_lock:
            total = len(self.queue_items)
        self._set_status(f"В очереди: {total}" if total else
                         "Добавьте ссылку(и) в очередь и нажмите «Старт»", kind="info")

    def _setup_translucency(self):
        """Раунд 57: лёгкая прозрачность окна; неактивное окно прозрачнее."""
        def _alpha(a):
            try:
                self.root.attributes("-alpha", a)
            except Exception:
                pass
        _alpha(0.92)
        try:
            self.root.bind("<Activate>", lambda e: _alpha(0.92), add="+")
            self.root.bind("<Deactivate>", lambda e: _alpha(0.78), add="+")
        except Exception:
            pass

    def _toggle_theme(self):
        """Раунд 57: смена темы — интерфейс перестраивается с сохранением
        очереди, текста полей, журнала, статуса и состояния запуска."""
        snap = {}
        try:
            snap = dict(
                url=self.url_entry.get(), tpl=self.name_template_var.get(),
                hidden=bool(self.show_hidden_var.get()), log=self.log.get("1.0", "end-1c"),
                status=self.status_var.get(), vars_open=self._vars_panel is not None,
            )
        except Exception:
            pass
        _apply_theme_globals(not THEME_DARK)
        _save_settings({"theme": "dark" if THEME_DARK else "light"})
        for w in list(self.root.winfo_children()):
            try:
                w.destroy()
            except Exception:
                pass
        self._build_style()
        self._build_ui()
        try:
            self.url_entry.insert(0, snap.get("url", ""))
            _tpl = snap.get("tpl", DEFAULT_NAME_TEMPLATE)
            self.name_template_var.set(DEFAULT_NAME_TEMPLATE if _tpl in OLD_DEFAULT_NAME_TEMPLATES else _tpl)
            self.show_hidden_var.set(snap.get("hidden", False))
            self.log.configure(state="normal")
            self.log.insert("end", snap.get("log", ""))
            self.log.see("end")
            self.log.configure(state="disabled")
            with self.queue_lock:
                for it in self.queue_items:
                    it.iid = self.tree.insert("", "end", values=self._row_values(it))
            if snap.get("vars_open"):
                self._show_template_help()
            if snap.get("status"):
                self._set_status(snap["status"], kind=getattr(self, "_status_kind", "info"))
            if self._processing:
                self.start_btn.config(state="disabled")
                self.progress.start(12)
        except Exception as e:
            self.log_msg(f"[интерфейс] восстановление после смены темы: {e}")

    def _set_status(self, text, kind="info"):
        self._status_kind = kind
        color = {"info": MUTED, "working": ACCENT, "done": OK_COLOR, "error": ERR_COLOR}.get(kind, MUTED)

        def _u():
            self.status_var.set(text)
            self.status_label.config(fg=color)

        self.root.after(0, _u)

    # ---------- запуск очереди ----------

    def start(self):
        if self._processing:
            return
        with self.queue_lock:
            has_pending = any(it.status == QueueItem.STATUS_PENDING for it in self.queue_items)
        if not has_pending:
            messagebox.showinfo("Очередь пуста", "Добавьте хотя бы одну ссылку в очередь перед стартом.")
            return

        template = self.name_template_var.get()
        try:
            render_name_template(template, self._build_name_context({}, "", index=1, total=1))
        except Exception as e:
            messagebox.showerror("Ошибка в шаблоне имени файла", str(e))
            return
        # Фиксируем шаблон на момент старта — дальше он читается из фонового
        # потока обработки очереди, а tk.StringVar лучше не трогать не из
        # главного потока.
        self._active_name_template = template

        self._processing = True
        self.start_btn.config(state="disabled")
        self._set_status("Запуск...", kind="working")
        self.root.after(0, self.progress.start, 12)
        threading.Thread(target=self._process_queue, daemon=True).start()

    # ---------- Chrome / CDP ----------

    def _cdp_alive(self):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json/version", timeout=1) as r:
                return r.status == 200
        except Exception:
            return False

    def _launch_chrome(self):
        os.makedirs(USER_DATA_DIR, exist_ok=True)
        args = [
            CHROME_MAC, f"--remote-debugging-port={CDP_PORT}", f"--user-data-dir={USER_DATA_DIR}",
            "--no-first-run", "--no-default-browser-check",
            # раунд 53: рендер страниц/планов на видеокарте (растеризация,
            # WebGL 3D-тура Zillow), даже если GPU в чёрном списке Chrome
            "--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--enable-zero-copy",
        ]
        self.log_msg("Запускаю Chrome...")
        try:
            self._chrome_proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            self.log_msg(f"Не удалось запустить Chrome: {e}")
            return False
        for _ in range(30):
            if self._cdp_alive():
                self.log_msg("Chrome готов")
                return True
            time.sleep(0.4)
        return False

    def _ensure_browser(self):
        """Подключается к Chrome один раз на всю очередь — переиспользуем
        одно и то же соединение Playwright/CDP для всех ссылок вместо
        переподключения на каждый тур."""
        if self.browser is not None:
            try:
                _ = self.browser.contexts
                return
            except Exception:
                self.browser = None

        if not self._cdp_alive():
            if not os.path.exists(CHROME_MAC):
                raise RuntimeError(f"Нет Chrome: {CHROME_MAC}")
            if not self._launch_chrome():
                raise RuntimeError("Chrome не ответил на 9222")
        else:
            self.log_msg("Chrome уже с remote debugging (тот же профиль)")

        if self.playwright is None:
            self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.connect_over_cdp(CDP_URL)
        self._install_px_watch()

    def _close_chrome(self):
        """Автоматическое закрытие Chrome после того, как вся очередь
        обработана: сначала пробуем «настоящее» закрытие через CDP,
        затем — на всякий случай — завершаем процесс, если это мы его
        запускали (chrome, оставленный пользователем открытым заранее,
        так же корректно закрывается через browser.close())."""
        try:
            if self.browser is not None:
                self.browser.close()
                self.log_msg("Chrome: соединение закрыто (browser.close())")
        except Exception as e:
            self.log_msg(f"[chrome] close() через CDP не сработал: {e}")
        finally:
            self.browser = None

        proc = self._chrome_proc
        if proc is not None:
            try:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except Exception:
                        proc.kill()
                    self.log_msg("Chrome закрыт (процесс завершён)")
            except Exception as e:
                self.log_msg(f"[chrome] не удалось завершить процесс Chrome: {e}")
            self._chrome_proc = None

        try:
            if self.playwright is not None:
                self.playwright.stop()
        except Exception:
            pass
        self.playwright = None

    def _refresh_cookies(self):
        try:
            parts = []
            for ctx in self.browser.contexts:
                for c in ctx.cookies():
                    parts.append(f"{c['name']}={c['value']}")
            self._cookies_header = "; ".join(parts)
        except Exception:
            pass

    # ---------- шаблон имени файла результата ----------

    def _build_name_context(self, meta, url, index=0, total=0):
        """Собирает пространство имён переменных, доступных в шаблоне имени
        файла (см. render_name_template/DEFAULT_NAME_TEMPLATE). meta — то,
        что вернул _process_zillow/_process_matterport (пустой словарь до
        начала обработки, например при проверке шаблона в start())."""
        counts = meta.get("counts") or {}
        now = datetime.now()
        return {
            "fl_count": counts.get("floors") or 0,
            "r_count": counts.get("rooms") or 0,
            "p_count": counts.get("points") or 0,
            "floors": counts.get("floors") or 0,
            "rooms": counts.get("rooms") or 0,
            "panoramas": counts.get("points") or 0,
            "platform": meta.get("platform") or "",
            "address": stringify_address(meta.get("address")),
            "model_name": meta.get("modelName") or "",
            "zpid": meta.get("zpid") or "",
            # площадь участка: sqft как на Zillow и м² (округлено до целого);
            # пустая строка, если на странице площади нет
            "lot_sqft": int(meta["lotSqft"]) if meta.get("lotSqft") else "",
            "lot_m2": int(round(meta["lotSqft"] * SQFT_TO_M2)) if meta.get("lotSqft") else "",
            "source_url": meta.get("sourceUrl") or url or "",
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H-%M-%S"),
            "datetime": now.strftime("%Y-%m-%d_%H-%M-%S"),
            "index": index or 0,
            "total": total or 0,
        }

    # ---------- основной пайплайн очереди ----------

    def _process_queue(self):
        processed = []
        self._worker_ident = threading.get_ident()
        self._px_last_check = 0.0
        time.hook = self._px_guard_tick
        try:
            self.log_msg("Подключаюсь к Chrome...")
            self._ensure_browser()

            while True:
                item = self._next_pending_item()
                if item is None:
                    break
                with self.queue_lock:
                    total = len(self.queue_items)
                self._set_queue_status(item, QueueItem.STATUS_RUNNING)
                self._set_status(f"Обрабатываю {item.index}/{total}: {item.url[:70]}", kind="working")
                self.log_msg(f"=== [{item.index}/{total}] {item.url} ===")
                try:
                    zip_path, platform_name = self._run_single(item, total)
                    item.result_path = zip_path
                    item.platform = platform_name
                    self._set_queue_status(item, QueueItem.STATUS_DONE)
                    self.log_msg(f"[очередь] готово: {os.path.basename(zip_path)}")
                except Exception as e:
                    item.error = str(e)
                    self._set_queue_status(item, QueueItem.STATUS_ERROR)
                    self.log_msg(f"[очередь] ошибка: {e}")
                processed.append(item)

        except Exception as e:
            self.log_msg(f"Критическая ошибка очереди: {e}")
            self._set_status(str(e), kind="error")
        finally:
            self.log_msg("Очередь обработана — закрываю Chrome...")
            self._close_chrome()
            self.root.after(0, self.progress.stop)
            self._processing = False
            self.root.after(0, lambda: self.start_btn.config(state="normal"))
            self.root.after(0, lambda: self._finish_queue(processed))

    def _show_scrollable_info(self, title, text):
        """Как messagebox.showinfo, но с прокруткой — обычный messagebox не
        резиновый и не даёт промотать длинный текст: при большой очереди
        (много ссылок) часть списка результатов внизу становится просто не
        видна и недоступна (окно упирается в границы экрана)."""
        win = tk.Toplevel(self.root)
        win.title(title)
        win.configure(bg=BG)
        win.geometry("760x560")
        win.minsize(420, 260)
        try:
            win.transient(self.root)
        except Exception:
            pass

        body = ttk.Frame(win, style="App.TFrame", padding=14)
        body.pack(fill="both", expand=True)
        box = scrolledtext.ScrolledText(
            body, wrap="word", font=FONT_UI, bg=PANEL, fg=TEXT, relief="flat",
            padx=10, pady=10, borderwidth=0,
        )
        box.pack(fill="both", expand=True)
        box.insert("1.0", text)
        box.configure(state="disabled")

        btn_row = ttk.Frame(body, style="App.TFrame")
        btn_row.pack(fill="x", pady=(10, 0))
        ttk.Button(btn_row, text="Закрыть", style="Accent.TButton", command=win.destroy).pack(side="right")

        win.bind("<Escape>", lambda e: win.destroy())
        try:
            win.grab_set()
        except Exception:
            pass
        win.focus_set()

    def _finish_queue(self, processed):
        if not processed:
            self._set_status("Очередь пуста", kind="info")
            return
        done = [it for it in processed if it.status == QueueItem.STATUS_DONE]
        errors = [it for it in processed if it.status == QueueItem.STATUS_ERROR]
        self._set_status(
            f"Очередь обработана: {len(done)} готово, {len(errors)} с ошибкой",
            kind="done" if not errors else "error",
        )
        lines = [f"✓ {os.path.basename(it.result_path)}  ({it.platform})\n   ← {it.url}" for it in done]
        lines += [f"✗ ОШИБКА\n   ← {it.url}\n   {it.error}" for it in errors]
        self._show_scrollable_info("Очередь обработана", "Chrome закрыт.\n\n" + "\n\n".join(lines))

    def _run_single(self, item, total):
        """Полный цикл для одной ссылки: новая вкладка → определение
        платформы → извлечение и скачивание → архивация. Вкладка
        закрывается по завершении (успешном или нет), сам Chrome
        закрывается один раз в конце всей очереди в _close_chrome()."""
        url = item.url
        self._original_url = url
        self._listing_floor_plan_urls = []
        self._listing_floor_plan_files = []
        self._pano_prefetch_gen = None  # раунд 54: старая фоновая загрузка больше не пишет
        self._pano_prefetch = None
        self._captured_rich_media_from_network = None
        self._network_watch_page = None
        self._network_watch_handler = None
        self._debug_capture_count = 0
        # Точные мировые координаты панорам: JSON imx_<revision>.json
        # (showcase.imx.source), который 3D-просмотрщик Zillow сам тянет
        # по сети при открытии тура. Напрямую он не скачивается (S3 отдаёт
        # 403 на любые запросы вне страницы — проверено), но из ЖИВОЙ
        # вкладки он доступен — поэтому перехватываем ответ (см.
        # _make_richmedia_response_handler). Если перехват не удался —
        # работает запасной путь «центроиды комнат официального SVG» (см.
        # _apply_showcase_floor_plan_positions).
        self._captured_imx_from_network = None
        self._px_net_hits = 0
        # площадь участка (sqft) — ищется на карточке объявления при первой загрузке
        self._lot_sqft = None
        # Активная вкладка — нужна _process_zillow_richmedia для
        # растеризации скачанных SVG-планов (_rasterize_svg_to_png).
        self._active_page = None
        # Данные, снятые прямо с интерактивной панели "Floor Plan" на
        # карточке Zillow (data-testid="pano-point" + соседний inline <svg>
        # чертежа с viewBox в метрах + подпись этажа), для форматов тура
        # ("showcase"), где richMedia не содержит panoLoc.world/
        # visualizations, а растрового плана нет вовсе. См.
        # _capture_interactive_floorplan_panel().
        self._listing_floor_plan_file_by_url = None
        self._listing_floor_plan_by_floor = None
        self._floorplan_captures = []
        self._reset_archive()
        ctx = self.browser.contexts[0] if self.browser.contexts else self.browser.new_context()
        target = ctx.new_page()
        self._active_page = target
        self._listing_floor_plan_file_by_url = None
        self._listing_floor_plan_by_floor = None
        try:
            target.goto(url, wait_until="domcontentloaded", timeout=60000)
            # Заглушка Zillow «Press & Hold» — пауза, пока человек её не пройдёт
            if not self._wait_for_human_check(target, "первая загрузка страницы"):
                raise RuntimeError("Zillow показал проверку «Press & Hold», и она не была пройдена — ссылка пропущена")
            if target.url and target.url.startswith("http"):
                self._referer = target.url
            self._refresh_cookies()

            self.log_msg("Определяю платформу (Zillow __NEXT_DATA__ / Matterport MP_PREFETCHED_MODELDATA)...")
            platform_name, payload, frame_url = self._detect_and_wait(target)
            links = mapping = meta = None
            if platform_name == "zillow":
                self._capture_lot_size(target, payload)

            # window.__NEXT_DATA__ есть практически на любой странице Zillow,
            # включая обычную карточку объявления (.../homedetails/.../
            # <zpid>_zpid/) — но данных тура (richMedia) в нём нет, пока тур
            # не открыт. Поэтому "нашли zillow" здесь ещё не значит "нашли
            # тур": отдельно проверяем richMedia и, если его нет, сами ищем
            # и открываем тур на странице.
            if platform_name == "zillow" and self._extract_rich_media(payload, quiet=True) is None:
                self.log_msg(
                    "[zillow] это похоже на карточку объявления без данных тура на самой странице — "
                    "сначала беру план из раздела Floor plan, потом открываю 3D-тур..."
                )
                # 1) Открыть «Floor Plan» в lightbox и скачать hero.png / plan.png
                # 2) Из того же lightbox — вкладка «3D Home» (если есть)
                # 3) Иначе — обычный поиск кнопки 3D Tour на карточке
                #
                # Сетевой перехват (см. _start_network_richmedia_watch)
                # включаем ДО открытия Floor Plan, а не только вокруг
                # клика «3D Home» — на интерактивном плане точки панорам
                # видны уже на вкладке Floor Plan, значит нужный запрос,
                # похоже, может уйти ещё на этом шаге.
                self._start_network_richmedia_watch(target)
                try:
                    self._open_and_capture_floor_plan(target)
                except Exception as e:
                    self.log_msg(f"[план][listing] не удалось захватить Floor Plan: {e}")

                opened_from_lightbox = False
                try:
                    target, opened_from_lightbox = self._enter_3d_home_from_lightbox(target, ctx)
                except Exception as e:
                    self.log_msg(f"[zillow] переход 3D Home из lightbox: {e}")
                finally:
                    self._stop_network_richmedia_watch()

                # Floor Plan и/или клик «3D Home» могли поймать richMedia
                # напрямую из сетевого ответа — на части объявлений это
                # единственный способ вообще получить данные тура, потому
                # что панель внутри lightbox не создаёт ни новой вкладки,
                # ни нового фрейма с __NEXT_DATA__. Если так — обрабатываем
                # сразу и НЕ ждём фреймы вообще.
                if self._captured_rich_media_from_network is not None:
                    self.log_msg(
                        "[zillow][network] нашёл данные тура в перехваченном сетевом ответе — "
                        "обрабатываю напрямую, без ожидания фреймов"
                    )
                    platform_name = "zillow"
                    frame_url = target.url or ""
                    # раунд 24: скриншоты этажей из ОТКРЫТОГО тура —
                    # вкладка Floors → этаж → галочка «3D Tour» → скриншот
                    # (схема пользователя); файлы ref_tour_floor<N>.png
                    # showcase-блок использует для точной расстановки
                    try:
                        self._screenshot_tour_floor_views(target)
                    except Exception as _e:
                        self.log_msg(f"[тур][эталон] скриншоты из тура не удались: {_e}")
                    links, mapping, meta = self._process_zillow_richmedia(
                        self._captured_rich_media_from_network, None
                    )
                else:
                    links = mapping = meta = None
                    if opened_from_lightbox:
                        new_target, opened = target, True
                    else:
                        new_target, opened = self._find_and_enter_zillow_tour(target, ctx)
                    if opened:
                        target = new_target
                        if target.url and target.url.startswith("http"):
                            self._referer = target.url
                        self._refresh_cookies()
                        platform_name, payload, frame_url = self._detect_and_wait(target)
                        # lightbox «3D Home» иногда только переключает UI, а richMedia
                        # так и не появляется — тогда ищем тур обычным способом
                        if platform_name == "zillow" and self._extract_rich_media(payload, quiet=True) is None:
                            self.log_msg(
                                "[zillow] после 3D Home в lightbox данных тура всё ещё нет — "
                                "ищу прямую ссылку / кнопку 3D Tour..."
                            )
                            new_target2, opened2 = self._find_and_enter_zillow_tour(target, ctx)
                            if opened2:
                                target = new_target2
                                if target.url and target.url.startswith("http"):
                                    self._referer = target.url
                                self._refresh_cookies()
                                platform_name, payload, frame_url = self._detect_and_wait(target)
                    else:
                        self.log_msg(
                            "[zillow] не нашёл на странице кнопку/ссылку 3D-тура — либо у этого объявления "
                            "его нет, либо разметка страницы отличается от ожидаемой"
                        )
                        platform_name = None

            if platform_name is None:
                raise RuntimeError(
                    "Не нашёл данных тура ни для Zillow, ни для Matterport ни в одном фрейме за "
                    f"{DETECT_WAIT_SEC:.0f} сек — это либо не тур (или объявление без 3D-тура), "
                    "либо страница ещё не прогрузилась"
                )
            self.log_msg(f"Платформа: {platform_name} (фрейм {frame_url[:80]})")

            if links is None:
                if platform_name == "zillow":
                    try:
                        self._screenshot_tour_floor_views(target)
                    except Exception as _e:
                        self.log_msg(f"[тур][эталон] скриншоты из тура не удались: {_e}")
                    links, mapping, meta = self._process_zillow(payload)
                else:
                    links, mapping, meta = self._process_matterport(payload)

            counts = meta.get("counts") or {}
            self._set_queue_item_meta(
                item, platform_name,
                counts.get("floors"), counts.get("rooms"), counts.get("points"),
            )

            context = self._build_name_context(meta, url, index=item.index, total=total)
            try:
                rendered_name = render_name_template(self._active_name_template, context)
            except Exception as e:
                self.log_msg(
                    f"[имя файла] ошибка в шаблоне «{self._active_name_template}»: {e} — "
                    "использую шаблон по умолчанию"
                )
                rendered_name = render_name_template(DEFAULT_NAME_TEMPLATE, context)
            if not meta.get("lotSqft"):
                rendered_name = cleanup_empty_units(rendered_name)
            base_name = sanitize_filename_result(rendered_name) + OUTPUT_EXT
            self.log_msg(f"[имя файла] «{base_name}»")

            zip_path = self._finalize(links, mapping, meta, base_name)
            self.log_msg(f"Готово: {platform_name} → {zip_path}")
            return zip_path, platform_name
        finally:
            try:
                target.close()
            except Exception:
                pass

    # ---------- проверка «Press & Hold» (PerimeterX) ----------

    # ---------- раунд 65: постоянный контроль формы «Press & Hold» ----------

    def _install_px_watch(self):
        """Сторож в странице + binding, через который он сообщает о форме."""
        self._px_flag = False
        self._px_flag_page = None
        try:
            ctxs = list(self.browser.contexts) or [self.browser.new_context()]
        except Exception:
            ctxs = []
        for ctx in ctxs:
            try:
                def _seen(source, url=None):
                    self._px_flag = True
                    try:
                        self._px_flag_page = source.get("page")
                    except Exception:
                        pass
                ctx.expose_binding("__grabberPxSeen", _seen)
            except Exception as e:
                if "already registered" not in str(e):
                    self.log_msg(f"[проверка] сторож: binding не установлен ({e}) — остаётся опрос")
            try:
                ctx.add_init_script(PX_WATCH_INIT_JS)
            except Exception as e:
                self.log_msg(f"[проверка] сторож: init-скрипт не установлен ({e}) — остаётся опрос")
            # раунд 74: уже открытые вкладки init-скрипт не получают — ставим сторожа вручную
            try:
                for pg in ctx.pages:
                    for fr in pg.frames:
                        try:
                            fr.evaluate(PX_WATCH_INIT_JS)
                        except Exception:
                            pass
            except Exception:
                pass
            # раунд 74: PerimeterX иногда не показывает форму, а молча отвечает 403/429
            # на запросы данных тура — тогда данные «не находятся». Такой ответ — повод
            # сразу проверить страницу (и перезагрузить её, если формы не видно).
            try:
                def _on_resp(resp):
                    try:
                        st = resp.status
                        if st not in (403, 429):
                            return
                        u = (resp.url or "").lower()
                        try:
                            rt = resp.request.resource_type
                        except Exception:
                            rt = ""
                        if rt not in ("document", "xhr", "fetch"):
                            return
                        if not (("zillow.com" in u) or ("captcha" in u) or ("perimeterx" in u)):
                            return
                        self._px_net_hits = getattr(self, "_px_net_hits", 0) + 1
                        self._px_flag = True
                    except Exception:
                        pass
                if not getattr(ctx, "_grabber_px_resp", False):
                    ctx.on("response", _on_resp)
                    ctx._grabber_px_resp = True
            except Exception:
                pass

    def _px_candidate_pages(self):
        pages = []
        fp = getattr(self, "_px_flag_page", None)
        if fp is not None:
            pages.append(fp)
        ap = getattr(self, "_active_page", None)
        if ap is not None and ap not in pages:
            pages.append(ap)
        try:
            for ctx in self.browser.contexts:
                for pg in ctx.pages:
                    if pg not in pages:
                        pages.append(pg)
        except Exception:
            pass
        out = []
        for pg in pages:
            try:
                if not pg.is_closed():
                    out.append(pg)
            except Exception:
                pass
        return out

    def _px_guard_tick(self):
        """Вызывается на каждой паузе и каждом сообщении лога. Работает ТОЛЬКО в
        рабочем потоке очереди (Playwright sync API однопоточный) и не чаще
        раза в PX_GUARD_INTERVAL_SEC — кроме случая, когда сторож в странице
        уже сообщил о форме."""
        if not getattr(self, "_processing", False):
            return
        if threading.get_ident() != getattr(self, "_worker_ident", None):
            return
        if getattr(self, "_px_guard_busy", False) or self.browser is None:
            return
        now = _REAL_TIME.monotonic()
        flagged = bool(getattr(self, "_px_flag", False))
        if not flagged and now - getattr(self, "_px_last_check", 0.0) < PX_GUARD_INTERVAL_SEC:
            return
        self._px_last_check = now
        self._px_guard_busy = True
        try:
            for pg in self._px_candidate_pages():
                # дешёвая предпроверка по всем фреймам (см. _px_quick_suspect)
                if not flagged and not self._px_quick_suspect(pg):
                    continue
                if not self._human_check_state(pg):
                    continue
                t0 = _REAL_TIME.monotonic()
                ok = self._wait_for_human_check(pg, "по ходу обработки")
                time.paused_total += _REAL_TIME.monotonic() - t0
                if not ok:
                    self.log_msg("[проверка] форма не пройдена — этот шаг, скорее всего, завершится ошибкой")
                break
        finally:
            self._px_flag = False
            self._px_flag_page = None
            self._px_guard_busy = False

    def _px_quick_suspect(self, page):
        """Раунд 74: дешёвая предпроверка по ВСЕМ фреймам (раньше — только главный
        фрейм и два селектора обёртки, из-за чего форма во фрейме или в другом
        варианте вёрстки иногда не замечалась): разметка PerimeterX, заголовок
        вкладки, адрес страницы проверки, ответы 403/429 на запросы Zillow."""
        hits = getattr(self, "_px_net_hits", 0)
        if hits:
            # разовый сигнал: проверяем страницу сейчас, но не на каждом круге опроса
            self._px_net_hits = 0
            self.log_msg(f"[проверка] Zillow ответил 403/429 на {hits} запрос(ов) данных — проверяю, нет ли формы «Press & Hold»")
            return True
        try:
            if PX_TITLE_RX.search(page.title() or ""):
                return True
        except Exception:
            pass
        try:
            frames = list(page.frames)
        except Exception:
            frames = []
        for fr in frames:
            try:
                u = (fr.url or "").lower()
            except Exception:
                u = ""
            if any(k in u for k in ("doubleclick.net", "googletagmanager", "google.com/recaptcha")):
                continue
            if "/captcha" in u or "px-captcha" in u or "perimeterx" in u:
                return True
            try:
                if fr.locator(PX_QUICK_SELECTOR).count():
                    return True
            except Exception:
                continue
        return False

    def _human_check_state(self, page):
        """Раунд 62: есть ли на экране ФОРМА «Press & Hold» — на всю страницу
        или всплывающим окном поверх сайта. Признаки собираются по всем фреймам
        (кнопка PerimeterX бывает в отдельном iframe) и только по видимым
        элементам. Никогда не бросает исключений."""
        agg = {"head": False, "btn": False, "ref": False, "before": False, "px": False,
               "box": False, "chal": False}
        title = ""
        try:
            frames = list(page.frames)
        except Exception:
            frames = []
        if not frames:
            try:
                frames = [page.main_frame]
            except Exception:
                frames = []
        # 0) раунд 64: настоящая разметка формы (прислана с живой страницы):
        #    <div id="px-captcha-wrapper"><div class="px-captcha-container">
        #      <img class="px-captcha-logo"> <div class="px-captcha-message">Press & Hold
        #      to confirm you are a human…</div> <div id="px-captcha"><iframe
        #      title="Human verification challenge"></iframe></div>
        #      <div class="px-captcha-refid">Reference ID …</div></div></div>
        #    Ищем локаторами Playwright (изолированный мир — подмены JS на
        #    странице проверки на них не влияют). Фон и обёртка страницы не важны:
        #    это и отдельная страница-заглушка, и окно «Before we continue…».
        via = "разметка px-captcha"
        for fr in frames:
            try:
                u = (fr.url or "").lower()
            except Exception:
                u = ""
            if any(k in u for k in ("doubleclick.net", "googletagmanager", "google.com/recaptcha")):
                continue
            try:
                box = fr.locator("#px-captcha-wrapper, .px-captcha-container")
                nb = box.count()
                for i in range(min(nb, 3)):
                    if box.nth(i).is_visible():
                        agg["box"] = True
                        break
                if nb:
                    msg = fr.locator(".px-captcha-message")
                    for i in range(min(msg.count(), 3)):
                        m = msg.nth(i)
                        if m.is_visible() and HUMAN_FORM_PARTS[0][1].search(" ".join((m.inner_text() or "").split())):
                            agg["head"] = True
                            break
                    ref = fr.locator(".px-captcha-refid")
                    for i in range(min(ref.count(), 3)):
                        if ref.nth(i).is_visible():
                            agg["ref"] = True
                            break
                # iframe кнопки может быть display:none, пока он грузится — поэтому
                # достаточно того, что он есть внутри #px-captcha
                if fr.locator('#px-captcha iframe[title*="Human verification" i]').count():
                    agg["chal"] = True
            except Exception:
                continue
        # раунд 74: страница-заглушка «Access to this page has been denied» — заголовок
        # вкладки + разметка PerimeterX (кнопка может ещё грузиться и быть невидимой)
        if not agg["box"]:
            try:
                t_ = page.title() or ""
            except Exception:
                t_ = ""
            if PX_TITLE_RX.search(t_):
                for fr in frames:
                    try:
                        if fr.locator(PX_QUICK_SELECTOR).count():
                            return {"hit": True, "title": t_, "pxEl": True, "txt": False, "btn": False,
                                    "ref": False, "modal": False, "via": "заголовок вкладки + разметка PerimeterX"}
                    except Exception:
                        continue
        if agg["box"] and (agg["head"] or agg["ref"] or agg["chal"]):
            try:
                title = page.title() or ""
            except Exception:
                title = ""
            return {"hit": True, "title": title, "pxEl": True, "txt": agg["head"], "btn": agg["chal"],
                    "ref": agg["ref"], "modal": False, "via": via}
        # 1) запасной путь — поиск по тексту локаторами (на случай другой вёрстки)
        via = "текст (локаторы)"
        for fr in frames:
            try:
                u = (fr.url or "").lower()
            except Exception:
                u = ""
            if any(k in u for k in ("doubleclick.net", "googletagmanager", "google.com/recaptcha")):
                continue
            for key, rx in HUMAN_FORM_PARTS:
                if agg[key]:
                    continue
                try:
                    loc = fr.get_by_text(rx)
                    n = loc.count()
                    for i in range(min(n, 4)):
                        if loc.nth(i).is_visible():
                            agg[key] = True
                            break
                except Exception:
                    continue
            if not agg["px"]:
                try:
                    box = fr.locator("#px-captcha").first
                    if box.count() and box.is_visible():
                        bb = box.bounding_box()
                        agg["px"] = bool(bb and bb.get("width", 0) >= 80 and bb.get("height", 0) >= 25)
                except Exception:
                    pass
        # 2) запасной путь — прежний JS в самой странице
        if not (agg["head"] or agg["btn"]):
            via = "JS"
            for fr in frames:
                try:
                    r = fr.evaluate(HUMAN_CHECK_JS)
                except Exception:
                    continue
                if not r:
                    continue
                for k in agg:
                    agg[k] = agg[k] or bool(r.get(k))
        try:
            title = page.title() or ""
        except Exception:
            title = ""
        # сама форма: заголовок-подсказка + хотя бы один её элемент;
        # либо кнопка «Press & Hold» вместе с «Reference ID» (подсказка могла
        # оказаться в другом, недоступном фрейме)
        hit = (agg["head"] and (agg["btn"] or agg["ref"] or agg["px"] or agg["before"])) or \
              (agg["btn"] and agg["ref"])
        if not hit:
            return None
        return {"hit": True, "title": title, "pxEl": agg["px"], "txt": agg["head"],
                "btn": agg["btn"], "ref": agg["ref"], "modal": agg["before"], "via": via}

    def _alert_user_human_check(self):
        """Звук + окно граббера поверх остальных на пару секунд — чтобы человек
        заметил, что нужно его действие."""
        def _u():
            try:
                self.root.bell()
                self.root.deiconify()
                self.root.lift()
                self.root.attributes("-topmost", True)
                self.root.after(2500, lambda: self.root.attributes("-topmost", False))
            except Exception:
                pass
        try:
            self.root.after(0, _u)
        except Exception:
            pass

    def _wait_for_human_check(self, page, where="загрузка страницы"):
        if getattr(self, "_px_guard_busy", False) and where != "по ходу обработки" and not where.endswith("(повторно)"):
            return True
        busy_before = getattr(self, "_px_guard_busy", False)
        self._px_guard_busy = True
        t0 = _REAL_TIME.monotonic()
        try:
            return self._wait_for_human_check_impl(page, where)
        finally:
            if not busy_before:
                self._px_guard_busy = False
                # время ожидания человека не в счёт таймаутов шага
                if where != "по ходу обработки":
                    time.paused_total += _REAL_TIME.monotonic() - t0

    def _wait_for_human_check_impl(self, page, where="загрузка страницы"):
        """Если Zillow показал «Press & Hold», ставим процесс на паузу и ждём,
        пока человек сам пройдёт проверку в окне браузера. Сам скрипт на кнопку
        НЕ нажимает. Возвращает True, если проверки не было или она пройдена;
        False — если за HUMAN_CHECK_MAX_WAIT_SEC её так и не прошли."""
        st = self._human_check_state(page)
        if not st:
            return True
        self.log_msg(f"[проверка] Zillow просит подтвердить, что вы человек («Press & Hold») — этап: {where}. "
                     f"Процесс на паузе: пройдите проверку в окне браузера "
                     f"(title={st.get('title', '')!r}, найдено по: {st.get('via', '?')}, текст={st.get('txt')}, "
                     f"Reference ID={st.get('ref')}, iframe проверки={st.get('btn')})")
        self._set_status("Пауза: пройдите «Press & Hold» в окне браузера", "error")
        try:
            page.bring_to_front()
        except Exception:
            pass
        self._alert_user_human_check()
        t0 = time.time()
        last_note = t0
        cleared_at = None
        while time.time() - t0 < HUMAN_CHECK_MAX_WAIT_SEC:
            time.sleep(HUMAN_CHECK_POLL_SEC)
            try:
                if page.is_closed():
                    self.log_msg("[проверка] вкладка закрыта, пока шло ожидание")
                    return False
            except Exception:
                pass
            st = self._human_check_state(page)
            if st:
                cleared_at = None
                if time.time() - last_note > 30:
                    last_note = time.time()
                    self.log_msg(f"[проверка] всё ещё жду прохождения «Press & Hold»… ({int(time.time() - t0)} с)")
                continue
            # заглушка пропала — подтверждаем, что это не мигание во время перезагрузки
            if cleared_at is None:
                cleared_at = time.time()
                continue
            if time.time() - cleared_at < 1.5:
                continue
            waited = int(time.time() - t0)
            self._px_net_hits = 0
            self.log_msg(f"[проверка] проверка пройдена через {waited} с — продолжаю")
            self._set_status("Проверка пройдена — продолжаю", "working")
            try:
                page.wait_for_load_state("domcontentloaded", timeout=30000)
            except Exception:
                pass
            # PerimeterX обычно сам перезагружает страницу; если нет — данные
            # объявления могут так и не появиться, поэтому перезагружаем сами
            try:
                has_data = page.evaluate("() => !!(document.querySelector('#__NEXT_DATA__') || window.__NEXT_DATA__ || window.MP_PREFETCHED_MODELDATA)")
            except Exception:
                has_data = False
            if not has_data:
                time.sleep(2.0)
                try:
                    has_data = page.evaluate("() => !!(document.querySelector('#__NEXT_DATA__') || window.__NEXT_DATA__ || window.MP_PREFETCHED_MODELDATA)")
                except Exception:
                    has_data = False
            if not has_data:
                self.log_msg("[проверка] после проверки данные страницы не появились — перезагружаю страницу")
                try:
                    page.reload(wait_until="domcontentloaded", timeout=60000)
                except Exception as e:
                    self.log_msg(f"[проверка] перезагрузка не удалась: {e}")
                # после перезагрузки проверка может показаться снова
                if self._human_check_state(page):
                    return self._wait_for_human_check_impl(page, where + " (повторно)")
            try:
                self._refresh_cookies()
            except Exception:
                pass
            return True
        self.log_msg(f"[проверка] «Press & Hold» не пройдена за {HUMAN_CHECK_MAX_WAIT_SEC // 60} мин — пропускаю ссылку")
        return False

    def _detect_and_wait(self, page, timeout_sec=DETECT_WAIT_SEC):
        deadline = time.time() + timeout_sec
        loops = 0
        while time.time() < deadline:
            loops += 1
            # заглушка «Press & Hold» может появиться и чуть позже загрузки; полная
            # (дорогая) проверка — только по быстрым признакам или раз в ~3 с
            if (self._px_quick_suspect(page) or loops % 6 == 1) and self._human_check_state(page):
                if not self._wait_for_human_check(page, "определение платформы"):
                    return None, None, None
                deadline = time.time() + timeout_sec   # время ожидания человека не в счёт
            for fr in page.frames:
                try:
                    r = fr.evaluate(DETECT_EXTRACT_JS)
                except Exception:
                    continue
                if not r:
                    continue
                if r.get("nextData"):
                    return "zillow", r["nextData"], fr.url
                if r.get("mpPrefetchedModelData"):
                    return "matterport", r["mpPrefetchedModelData"], fr.url
            time.sleep(POLL_INTERVAL)
        return None, None, None

    def _find_and_enter_zillow_tour(self, page, ctx, wait_sec=8.0):
        """Ссылка на объявление (homedetails) не содержит данных тура
        заранее — тур на такой странице открывается только по клику на
        плашку «3D Tour» / «Virtual Tour». Пробуем два способа, от более
        надёжного к менее надёжному:

          1. Поискать в HTML/встроенных данных страницы уже готовую прямую
             ссылку на тур (find_zillow_tour_url) и перейти по ней напрямую
             — это не зависит от того, как именно оформлена кнопка.
          2. Если готовой ссылки нет — найти саму кнопку/плашку по
             распространённым атрибутам или подписи текста и нажать её:
             тур либо подгружается на этой же странице отдельным фреймом
             (см. _detect_and_wait, который проверяет все фреймы), либо
             открывается в новой вкладке — в этом случае переключаемся
             на неё и закрываем исходную вкладку с объявлением.

        Если ни один из способов не сработал (например, у объявления
        просто нет 3D-тура), возвращает исходную страницу без изменений.
        Возвращает (page, найдено_ли: bool)."""
        deadline = time.time() + wait_sec
        while time.time() < deadline:
            try:
                html = page.evaluate("() => document.documentElement.outerHTML")
            except Exception:
                html = None

            direct_url = find_zillow_tour_url(html) if html else None
            if direct_url:
                self.log_msg(f"[zillow] нашёл прямую ссылку на 3D-тур в данных страницы: {direct_url[:120]}")
                try:
                    page.goto(direct_url, wait_until="domcontentloaded", timeout=60000)
                    self._wait_for_human_check(page, "переход на страницу 3D-тура")
                    return page, True
                except Exception as e:
                    self.log_msg(f"[zillow] не удалось перейти по найденной ссылке: {e}")

            for selector in ZILLOW_TOUR_TRIGGER_SELECTORS:
                try:
                    loc = page.locator(selector).first
                    if loc.count() == 0 or not loc.is_visible():
                        continue
                    loc.scroll_into_view_if_needed(timeout=2000)
                    loc.click(timeout=3000)
                    self.log_msg(f"[zillow] нашёл и нажал плашку 3D-тура ({selector})")
                    return self._after_zillow_tour_click(page, ctx)
                except Exception:
                    continue

            for pattern in (re.compile(r"3d\s*tour", re.I), re.compile(r"virtual\s*tour", re.I)):
                try:
                    loc = page.get_by_text(pattern).first
                    if loc.count() == 0 or not loc.is_visible():
                        continue
                    loc.scroll_into_view_if_needed(timeout=2000)
                    loc.click(timeout=3000)
                    self.log_msg(f"[zillow] нашёл и нажал ссылку по тексту «{pattern.pattern}»")
                    return self._after_zillow_tour_click(page, ctx)
                except Exception:
                    continue

            time.sleep(0.5)
        return page, False

    def _after_zillow_tour_click(self, page, ctx):
        """После клика по плашке тура даём странице секунду на реакцию и
        проверяем, не открылась ли новая вкладка (частый вариант для
        внешних 3D-туров). Если открылась — переключаемся на неё и
        закрываем исходную вкладку с объявлением, она больше не нужна."""
        time.sleep(1.2)
        newer = [p for p in ctx.pages if p is not page and p.url and p.url != "about:blank"]
        if newer:
            new_page = newer[-1]
            self.log_msg(f"[zillow] 3D-тур открылся в новой вкладке: {new_page.url[:120]}")
            try:
                page.close()
            except Exception:
                pass
            return new_page, True
        return page, True

    # ---------- Zillow ----------

    def _extract_rich_media(self, next_data, quiet=False):
        try:
            page_props = next_data["props"]["pageProps"]
            cache = json.loads(page_props["apiClientConfig"]["serializedCache"])
        except Exception as e:
            if not quiet:
                self.log_msg(f"[zillow] не удалось разобрать serializedCache: {e}")
            return None
        for _, val in cache.items():
            if isinstance(val, dict) and "richMedia" in val:
                return val["richMedia"]
        return None

    def _count_rooms_by_plan(self, rich_media, next_data=None):
        """Сколько комнат подписано на планах этажей. SVG берём из уже
        скачанных файлов архива, недостающие этажи — по ссылкам из данных
        тура (visualizations[].svg / floors[].primarySvgSource). Одна и та же
        комната в разных копиях SVG считается один раз (по id заметки)."""
        plans = []
        for p in glob.glob(os.path.join(ARCHIVE_DIR, "*.svg")):
            try:
                with open(p, "r", encoding="utf-8", errors="replace") as fh:
                    plans.append((os.path.basename(p), plan_svg_rooms_full(fh.read())))
            except Exception:
                pass
        urls = collect_plan_svg_urls(rich_media or {})
        if next_data is not None:
            for k, v in collect_plan_svg_urls(next_data).items():
                urls.setdefault(k, []).extend(u for u in v if u not in urls.get(k, []))
        for fid, lst in urls.items():
            path = os.path.join(ARCHIVE_DIR, f"plan_rooms_{fid}.svg")
            if not os.path.exists(path):
                ok = False
                for u in sorted(lst, key=lambda u: "fixtures" in u):
                    if download_file(u, path, self._cookies_header, self._referer or self._original_url, None):
                        ok = True
                        break
                if not ok:
                    continue
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    plans.append((os.path.basename(path), plan_svg_rooms_full(fh.read())))
            except Exception:
                pass
        rooms, report = merge_floor_plans(plans)
        for name, n, st in report:
            self.log_msg(f"[данные] план {name}: {n} помещ. — {st}")
        if rooms:
            labels = sorted(v or "?" for v in rooms.values())
            self.log_msg(f"[данные] помещения на плане ({len(rooms)}): {', '.join(labels)[:400]}")
        return len(rooms) or None

    def _capture_lot_size(self, page, next_data=None):
        """Площадь участка: сначала из данных страницы (__NEXT_DATA__ /
        gdpClientCache), затем из текста страницы. Только лог, без исключений."""
        if getattr(self, "_lot_sqft", None):
            return
        v = None
        try:
            if next_data is not None:
                v = find_lot_sqft(next_data)
        except Exception:
            v = None
        if not v and page is not None:
            try:
                v = find_lot_sqft_in_text(page.evaluate("() => document.body ? document.body.innerText.slice(0, 200000) : ''"))
            except Exception:
                v = None
        if v:
            self._lot_sqft = v
            self.log_msg(f"[данные] площадь участка: {v} sqft ≈ {round(v * SQFT_TO_M2)} м²")

    def _process_zillow(self, next_data):
        rich_media = self._extract_rich_media(next_data)
        if rich_media is None:
            raise RuntimeError("В __NEXT_DATA__ не нашлось richMedia (структура страницы отличается)")
        return self._process_zillow_richmedia(rich_media, next_data)

    def _try_fetch_imx_from_page(self, rich_media):
        """Раунд 21: если сетевой перехват не поймал vrmodels/imx_*.json
        (3D-просмотрщик за время захвата сам его не запросил — бывает
        регулярно), пробуем скачать модель ИЗНУТРИ живой вкладки: URL
        модели Zillow пишет прямо в richMedia (imx.source =
        https://www.zillowstatic.com/vrmodels/imx_<rev>.json), но наружу
        CDN отвечает 403 — из контекста страницы zillow.com файл читается
        браузером (его собственные заголовки/куки). Успех → точные позиции
        всех панорам («как на Zillow»), без интерполяции. Неуспех — тихо
        работаем по-старому (полигоны комнат + подписи)."""
        if self._captured_imx_from_network:
            return
        src = ((rich_media or {}).get("imx") or {}).get("source")
        page = getattr(self, "_active_page", None)
        if not src or page is None or not hasattr(page, "evaluate"):
            return
        try:
            self.log_msg(f"[zillow][imx] перехват пуст, догружаю модель из вкладки: {src}")
            txt = page.evaluate(
                "async (u) => { const r = await fetch(u, {credentials: 'include'});"
                " if (!r.ok) throw new Error('HTTP ' + r.status);"
                " return await r.text(); }",
                src,
            )
            obj = json.loads(txt)
            if isinstance(obj, (dict, list)) and obj:
                self._captured_imx_from_network = {"imx_page_fetch.json": obj}
                self.log_msg("[zillow][imx] модель получена из вкладки — будут точные позиции панорам")
            else:
                self.log_msg("[zillow][imx] ответ вкладки пустой/не JSON — остаюсь на запасном пути")
        except Exception as e:
            self.log_msg(f"[zillow][imx] не смог догрузить модель из вкладки ({type(e).__name__}: {e}) — остаюсь на запасном пути")

    def _process_zillow_richmedia(self, rich_media, next_data=None):
        """Собственно обработка richMedia (панорамы/планы/комнаты) —
        вынесено из _process_zillow() отдельным методом, чтобы можно было
        скормить сюда richMedia, пойманный напрямую из сетевого ответа
        (см. _start_network_richmedia_watch / self._captured_rich_media_
        from_network), когда его вообще не было ни в window.__NEXT_DATA__,
        ни в каком-либо фрейме. next_data нужен только для best-effort
        поиска адреса (deep_find_address) — если его нет (данные пришли
        из сети, не со страницы), адрес просто останется пустым."""
        try:
            with open(RAW_DATA_PATH, "w", encoding="utf-8") as f:
                json.dump(rich_media, f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.log_msg(f"[данные] не удалось сохранить raw_data.json: {e}")

        # раунд 21: если imx не перехватился — догружаем из вкладки
        self._try_fetch_imx_from_page(rich_media)

        panos = rich_media.get("panos") or []
        self.log_msg(f"[данные] найдено панорам: {len(panos)}")
        if not panos:
            raise RuntimeError("richMedia.panos пуст — нечего скачивать")

        floors = {f.get("id"): f for f in (rich_media.get("floors") or [])}
        world_by_pano = {w.get("panoId"): w for w in ((rich_media.get("panoLoc") or {}).get("world") or [])}
        viz_by_floor = {v.get("floorId"): v for v in (rich_media.get("visualizations") or [])}
        rooms = rich_media.get("rooms") or []
        room_id_by_pano = {}
        # У richMedia, пойманного из GraphQL-ответа «showcase» (см.
        # _find_richmedia_in_obj / debug_captured_response_*.json от
        # реального прогона 2026-09-20), формат комнат другой, чем у
        # классического richMedia из __NEXT_DATA__: есть готовая прямая
        # карта allPanosToRooms {panoEntityId: roomFloorMapRoomId} — берём
        # её первым делом, она надёжнее. rooms[] в этом формате даёт не
        # список panoIds, а одиночный rooms[].panoId (плюс сама комната
        # определяется по floorMapRoomId, а не по id) — поддерживаем и то,
        # и то, не ломая старый формат (rooms[].panoIds).
        all_panos_to_rooms = rich_media.get("allPanosToRooms")
        if isinstance(all_panos_to_rooms, dict):
            room_id_by_pano.update(all_panos_to_rooms)
        for r in rooms:
            room_id = r.get("id") or r.get("floorMapRoomId")
            for pid in (r.get("panoIds") or []):
                room_id_by_pano.setdefault(pid, room_id)
            single_pano_id = r.get("panoId")
            if single_pano_id:
                room_id_by_pano.setdefault(single_pano_id, room_id)

        # richMedia.rooms у Zillow на практике пуст в большинстве туров (хотя
        # структурно поле есть) — даже когда у самих панорам title заполнен
        # человекочитаемым названием комнаты («Kitchen», «Primary Bedroom»
        # и т.п.). Поэтому число комнат для счётчиков/имени файла считаем как
        # максимум из двух источников: сколько записей в rooms[] реально
        # пришло от Zillow, и сколько РАЗНЫХ непустых title у панорам — так
        # результат не проваливается в 0 всякий раз, когда rooms[] пуст.
        distinct_room_titles = {
            (p.get("title") or "").strip() for p in panos if (p.get("title") or "").strip()
        }
        room_count = max(len(rooms), len(distinct_room_titles))

        # ---- задачи на скачивание планов этажей ----
        plan_info_by_floor = {}
        plan_tasks = []
        for floor_id, viz in viz_by_floor.items():
            png = (viz or {}).get("png") or {}
            src = png.get("src")
            if not src:
                continue
            floor_name = (floors.get(floor_id) or {}).get("name") or floor_id
            fname = f"plan_{safe_filename(floor_name)}_{floor_id}.png" if len(viz_by_floor) > 1 else "plan.png"
            path = os.path.join(ARCHIVE_DIR, fname)
            plan_info_by_floor[floor_id] = {
                "file": fname, "bounds": png.get("bounds"), "scale": png.get("scale"),
                "src": src, "_name": floor_name,
            }
            plan_tasks.append(DownloadTask(src, path, label=f"план «{floor_name}»", meta={"floor_id": floor_id}))

        # ---- задачи на скачивание панорам + заготовки links[] ----
        links = []
        pano_tasks = []
        n = 0
        for p in panos:
            n += 1
            pano_id = p.get("entityId")
            title = p.get("title") or ""
            floor_id = p.get("floorId")
            urls = p.get("textureFileUrls") or {}
            src = urls.get("pano8k") or urls.get("pano4k")
            if not src or not pano_id:
                self.log_msg(f"[пропуск] панорама без entityId/ссылки: {p}")
                continue
            ext = os.path.splitext(src.split("?")[0])[1] or ".avif"
            room_s = safe_room(title)
            fname = f"{n}_{room_s}_{pano_id}{ext}" if room_s else f"{n}_{pano_id}{ext}"
            fpath = os.path.join(ARCHIVE_DIR, fname)

            world = world_by_pano.get(pano_id) or {}
            center = world.get("center") or {}
            heading_deg = first_number(world) or first_number(p)
            neighbors = []
            for d in (p.get("destinations") or []):
                nb = {"id": d.get("destEntityId"), "room": d.get("title")}
                angle_deg = first_number(d)
                if angle_deg is not None:
                    nb["angleDeg"] = angle_deg  # см. first_number() — сегодня почти
                    # никогда не сработает, но если Zillow когда-нибудь начнёт
                    # отдавать угол перехода в одном из привычных полей, он
                    # сразу попадёт в links.json без изменений в этом коде.
                neighbors.append(nb)

            link = {
                "n": n,
                "platform": "zillow",
                "id": pano_id,
                "room": title or None,
                "floor": {"id": floor_id, "label": (floors.get(floor_id) or {}).get("name")},
                "world": {"x": center.get("x"), "y": center.get("y"), "z": center.get("z")} if center else None,
                "files": [],
                "plan_type": "official",
                "plan_px": None,
                "plan_file": None,
                "neighbors": neighbors,
                "extra": {
                    "roomId": room_id_by_pano.get(pano_id),
                    "order": world.get("order"),
                    **({"headingDeg": heading_deg} if heading_deg is not None else {}),
                },
            }
            links.append(link)
            pano_tasks.append(DownloadTask(
                src, fpath, label=f"«{title}» ({pano_id})",
                meta={"pano_id": pano_id, "title": title, "fname": fname, "link": link},
            ))

        # ---- всё скачивается одним пулом потоков сразу (план + панорамы),
        # неудачные загрузки автоматически повторяются внутри run_download_batch ----
        try:
            self._take_prefetched_panos(pano_tasks)  # раунд 54
        except Exception as e:
            self.log_msg(f"[скачивание][фон] приём не удался: {e} — качаю всё заново")
        run_download_batch(plan_tasks + [t for t in pano_tasks if not t.success],
                           self._cookies_header, self._referer, self.log_msg)

        for t in plan_tasks:
            info = plan_info_by_floor[t.meta["floor_id"]]
            if t.success:
                self.log_msg(f"[план] этаж «{info['_name']}»: {t.path}")
            else:
                info["file"] = None

        mapping = {}
        for t in pano_tasks:
            link = t.meta["link"]
            pano_id, title, fname = t.meta["pano_id"], t.meta["title"], t.meta["fname"]
            if t.success:
                link["files"] = [fname]
                mapping[pano_id] = title
                self.log_msg(f"[сохранено] {fname} ← «{title}» (panoId={pano_id})")
            else:
                self.log_msg(f"[ошибка скачивания] {pano_id} ({title}) — {t.url}")

        for link in links:
            floor_id = link["floor"]["id"]
            plan_info = plan_info_by_floor.get(floor_id)
            pano_id = link["id"]
            world = world_by_pano.get(pano_id) or {}
            center = world.get("center") or {}
            if plan_info and plan_info.get("bounds") and plan_info.get("scale") and center:
                px, py = self._world_to_pixel(center, plan_info["bounds"], plan_info["scale"])
                link["plan_px"] = {"x": px, "y": py} if px is not None else None
            link["plan_file"] = (plan_info or {}).get("file")

        self._annotate_zillow_plans(plan_info_by_floor, links)

        # ---- план с карточки объявления (вкладка «Floor plan») ----
        # У многих туров нет richMedia.visualizations, но на самой карточке
        # объявления (homedetails) Zillow показывает готовый план — SVG
        # floor_map или загруженное фото. Мы сохранили URL-ы до перехода
        # в тур (см. _listing_floor_plan_urls). Если официальных планов
        # из тура нет — скачиваем эти и привязываем ко всем точкам.
        listing_plan_files = self._download_listing_floor_plans()
        if listing_plan_files:
            # Раунд 16: у многоэтажных объявлений план с карточки — ПО ОДНОМУ
            # НА ЭТАЖ (floor_shape/<floorId>/ в URL). Привязываем каждой ссылке
            # план ИМЕННО её этажа; первый файл — только как запас, если
            # соответствие этажу не найдено (одиночный план/фото).
            by_floor = self._listing_floor_plan_by_floor or {}
            bound = 0
            for link in links:
                if link.get("plan_file"):
                    continue
                fname = by_floor.get((link.get("floor") or {}).get("id"))
                if not fname:
                    fname = listing_plan_files[0]
                link["plan_file"] = fname
                link["plan_type"] = "listing_floor_plan"
                bound += 1
            self.log_msg(
                f"[план] с карточки объявления (Floor plan): {len(listing_plan_files)} файл(ов), "
                f"привязано {bound} ссылкам по своим этажам → " + ", ".join(listing_plan_files)
            )

        # ---- ОФИЦИАЛЬНЫЙ SVG-ПЛАН + ПОЗИЦИИ КАМЕР ИЗ richMedia ("showcase") ----
        # В richMedia формата showcase есть всё нужное: floors[].primarySvgSource
        # (SVG плана этажа в метрах, публичный CDN) и связь панорам с
        # комнатами (allPanosToRooms/rooms[], floorMapRoomId = id групп в
        # SVG). Подробнее см. _apply_showcase_floor_plan_positions.
        # Приоритет НИЖЕ официальных visualizations (bounds/scale), но ВЫШЕ
        # панели Floor Plan и схемы-гипотезы (панель ненадёжна: в живом
        # прогоне 2026-09-20 не отрендерилась к моменту захвата, а
        # перезапись «проценты → px произвольной картинки» геометрически
        # неверна из-за letterbox — см. раунд 15 в статусе).
        try:
            self._apply_showcase_floor_plan_positions(
                links, panos, rich_media, skip_floor_ids=set(viz_by_floor)
            )
        except Exception as e:
            self.log_msg(f"[план][showcase] ошибка (продолжаю без него): {e}")

        # ---- ПАНЕЛЬ FLOOR PLAN (формат "showcase") → plan_px ----
        # Источник: интерактивная панель Floor Plan на карточке (см.
        # _capture_interactive_floorplan_panel / _rasterize_plan_svgs_
        # from_captures, вызываются из _open_and_capture_floor_plan —
        # ДО открытия тура). Проценты top/left у pano-point —
        # барицентрические координаты viewBox чертежа плана (слой точек
        # Zillow подогнан под аспект viewBox):
        #     X = vbX + left%/100*vbW;   Y = vbY + top%/100*vbH
        # (проверено на реальном MHTML 18765 Labrador St, zpid 20176199:
        # 16/16 точек в контуре дома, 14/16 строго в полигонах комнат).
        # PNG растеризован нами из ТОГО ЖЕ SVG с точным аспектом viewBox,
        # поэтому перевод в пиксели прямой, без letterbox-поправок:
        #     plan_px.x = (X - vbX) / vbW * ширина_PNG
        #     plan_px.y = (Y - vbY) / vbH * высота_PNG
        # Сопоставление точек с panos[] — ПО ПОРЯДКУ, отдельно в пределах
        # КАЖДОГО этажа, и только при точном равенстве количеств (порядок
        # рендера панели следует порядку richMedia.panos[] — оба списка
        # рисуются из одного массива; гипотеза проверяется вживую по логу,
        # см. статус, раунд 14). Этажи связываются по подписи <label> панели
        # с именем этажа из richMedia.floors (без учёта регистра/разделителей);
        # если подписи не уникальны/не совпали — единственная пара «один
        # захваченный этаж × один этаж тура без плана». Официальные планы
        # из visualizations (bounds/scale) имеют приоритет — такие этажи
        # панельным источником не трогаются вовсе.
        panel_caps = list(self._floorplan_captures or [])
        if panel_caps:
            def _norm_floor(s):
                return re.sub(r"[^a-z0-9а-яё]", "", (s or "").lower())

            floors_by_norm = {}
            for fid, f in floors.items():
                nm = (f or {}).get("name") or ""
                if _norm_floor(nm):
                    floors_by_norm.setdefault(_norm_floor(nm), []).append(fid)

            cap_for_floor = {}
            unmatched = []
            for cap in panel_caps:
                fids = floors_by_norm.get(_norm_floor(cap.get("label"))) or []
                if len(fids) == 1 and fids[0] not in cap_for_floor:
                    cap_for_floor[fids[0]] = cap
                else:
                    unmatched.append(cap)
            if unmatched:
                # резерв: один захваченный этаж и один «непокрытый» этаж тура
                tour_floor_ids = [
                    p.get("floorId") for p in panos
                    if p.get("floorId") and p.get("floorId") not in cap_for_floor
                ]
                distinct_ids = list(dict.fromkeys(tour_floor_ids))
                if len(unmatched) == 1 and len(distinct_ids) == 1:
                    cap_for_floor[distinct_ids[0]] = unmatched[0]
                    unmatched = []
            if unmatched:
                self.log_msg(
                    "[план][панель] не сопоставлено захваченных этажей: "
                    f"{len(unmatched)} (подписи панели: {[c.get('label') for c in unmatched]}; "
                    f"этажи richMedia: {[(f or {}).get('name') for f in floors.values()]})"
                )

            links_by_id = {l["id"]: l for l in links}
            panel_applied = 0
            for floor_id, cap in cap_for_floor.items():
                floor_name = (floors.get(floor_id) or {}).get("name") or floor_id or "?"
                if floor_id in viz_by_floor:
                    self.log_msg(
                        f"[план][панель] этаж «{floor_name}»: есть официальный план из "
                        "richMedia.visualizations — панельный источник не нужен"
                    )
                    continue
                dots = [d for d in (cap.get("dots") or []) if d is not None]
                floor_panos = [p for p in panos if p.get("floorId") == floor_id]
                if not dots or not floor_panos:
                    continue
                if len(dots) != len(floor_panos):
                    self.log_msg(
                        f"[план][панель] этаж «{floor_name}»: точек на панели {len(dots)}, "
                        f"панорам в туре {len(floor_panos)} — числа не совпадают, "
                        "порядковое сопоставление ненадёжно, этаж пропущен"
                    )
                    continue
                vb = cap.get("viewbox") or []
                w, h = cap.get("png_w"), cap.get("png_h")
                if len(vb) != 4 or not w or not h:
                    self.log_msg(
                        f"[план][панель] этаж «{floor_name}»: нет viewBox или PNG плана — пропущен"
                    )
                    continue
                vbX, vbY, vbW, vbH = (float(v) for v in vb)
                png_file = cap.get("png_file")
                self.log_msg(
                    f"[план][панель] этаж «{floor_name}»: {len(dots)} точек ↔ "
                    f"{len(floor_panos)} панорам, сопоставляю по порядку "
                    f"(viewBox=({vbX:.2f},{vbY:.2f},{vbW:.2f},{vbH:.2f}) м, "
                    f"план {png_file} {w}x{h}px)"
                )
                for p, d in zip(floor_panos, dots):
                    link = links_by_id.get(p.get("entityId"))
                    if link is None or link.get("plan_px"):
                        continue
                    left, top = d
                    if link.get("plan_file") and link["plan_file"] != png_file:
                        # план уже привязан из другого источника — координаты
                        # другой системы отсчёта не примешиваем
                        continue
                    xm = vbX + left / 100.0 * vbW
                    ym = vbY + top / 100.0 * vbH
                    link["plan_file"] = png_file
                    link["plan_px"] = {
                        "x": round((xm - vbX) / vbW * w, 1),
                        "y": round((ym - vbY) / vbH * h, 1),
                    }
                    link["plan_type"] = "floor_plan_panel_svg"
                    extra = link.setdefault("extra", {})
                    extra["floorplanDotPct"] = {"x": left, "y": top}
                    extra["floorplanMeters"] = {"x": round(xm, 3), "y": round(ym, 3)}
                    panel_applied += 1
            if panel_applied:
                self.log_msg(
                    f"[план][панель] plan_px проставлен для {panel_applied} панорам "
                    "(источник: панель Floor Plan — проценты → метры viewBox → "
                    "пиксели растеризованного inline SVG)"
                )

        # ---- этажи без официального плана И без мировых координат панорам —
        # значит, у Zillow для этого тура вообще нет пространственных данных
        # (см. _draw_zillow_angle_schematic — на практике это большинство
        # туров более старого/простого формата). Строим для них приблизительную
        # схему по графу углов переходов вместо архива вовсе без плана.
        # Если уже есть план с карточки — гипотезу не рисуем: реальный план
        # важнее приблизительной схемы по углам. ----
        world_floor_ids = {
            p.get("floorId") for p in panos if world_by_pano.get(p.get("entityId"))
        }
        pano_num_by_id = {p.get("entityId"): i for i, p in enumerate(panos, start=1) if p.get("entityId")}
        panos_by_floor = {}
        for p in panos:
            panos_by_floor.setdefault(p.get("floorId"), []).append(p)

        for floor_id, floor_panos in panos_by_floor.items():
            if floor_id in viz_by_floor or floor_id in world_floor_ids:
                continue  # для этого этажа официальные данные (план или мир) есть
            # уже есть план с карточки — не затираем его schematic'ом
            if any(
                (link.get("floor") or {}).get("id") == floor_id and link.get("plan_file")
                for link in links
            ):
                continue
            floor_label = (floors.get(floor_id) or {}).get("name") or floor_id or "floor"
            entrance_id = (floors.get(floor_id) or {}).get("entrancePanoId")
            fname, positions = self._draw_zillow_angle_schematic(
                floor_id, floor_panos, floor_label, pano_num_by_id, entrance_pano_id=entrance_id,
            )
            if not fname:
                continue
            for link in links:
                if link["floor"]["id"] != floor_id:
                    continue
                pos = positions.get(link["id"])
                if pos:
                    link["plan_px"] = pos
                link["plan_file"] = fname
                link["plan_type"] = "schematic_hypothesis"

        # Доп. свойства для показа/подстановки в шаблон имени файла —
        # адрес ищется best-effort'ом (см. deep_find_address), zpid — из
        # исходной ссылки на объявление, если она содержала /<zpid>_zpid/.
        # next_data может отсутствовать, если richMedia пришёл напрямую из
        # перехваченного сетевого ответа, а не со страницы — тогда адрес
        # просто не находим (не критично, в шаблоне имени файла он и так
        # опционален).
        address = deep_find_address(next_data) if next_data is not None else None
        zpid = extract_zpid(self._referer) or extract_zpid(self._original_url)
        if address:
            self.log_msg(f"[данные] адрес: {address}")
        if zpid:
            self.log_msg(f"[данные] zpid: {zpid}")

        # Раунд 66: комнаты = подписанные на плане этажа помещения с размерами
        rooms_source = "panoramas"
        try:
            plan_rooms = self._count_rooms_by_plan(rich_media, next_data)
        except Exception as e:
            plan_rooms = None
            self.log_msg(f"[данные] комнаты по плану: ошибка {e}")
        if plan_rooms:
            self.log_msg(f"[данные] комнат по плану: {plan_rooms} (раньше считалось бы {room_count})")
            room_count = plan_rooms
            rooms_source = "plan"
        else:
            self.log_msg(f"[данные] SVG-плана нет — комнаты по названиям панорам: {room_count}")

        meta = {
            "platform": "zillow",
            "grabberVersion": GRABBER_VERSION,
            "sourceUrl": self._referer,
            "counts": {"points": len(links), "floors": len(floors), "rooms": room_count},
            "roomsSource": rooms_source,
            "address": address,
            "zpid": zpid,
            "lotSqft": None,
        }
        if not getattr(self, "_lot_sqft", None) and next_data is not None:
            self._capture_lot_size(None, next_data)
        if getattr(self, "_lot_sqft", None):
            meta["lotSqft"] = self._lot_sqft
            meta["lotM2"] = round(self._lot_sqft * SQFT_TO_M2, 1)
        return links, mapping, meta

    def _open_and_capture_floor_plan(self, page):
        """Открыть lightbox «Floor Plan» на карточке объявления и скачать
        настоящий план (hero.png / screenshot). Вызывается ДО 3D-тура
        и ДО панорам.

        На Zillow после клика открывается медиа-viewer с вкладками
        Photos | Floor Plan | 3D Home. Картинка плана — обычно
        zillowstatic.com/floor_map/<id>/hero.png.
        """
        self.log_msg("[план][listing] открываю Floor Plan на карточке...")

        # 1) Открыть lightbox / вкладку Floor Plan
        floor_selectors = [
            # вкладка внутри уже открытого media lightbox
            '#floorplan-tab',
            'button[aria-label="view floor plan"]',
            'button[value="floorplan"]',
            '[aria-controls="floorplan-panel"]',
            # плашка на карточке объявления
            '[data-testid="persistent-tab-floor_plan"]',
            '[data-testid="floor-plan-thumbnail"]',
            '[data-testid="floor-map-tile-image"]',
            'button[aria-label="Floor plan"]',
            'button[aria-label*="Floor plan" i]',
            'a[aria-label*="Floor plan" i]',
            '[mediatype="FLOOR_PLAN"]',
            'button:has-text("Floor Plan")',
            'button:has-text("Floor plan")',
            'a:has-text("Floor Plan")',
            'a:has-text("Floor plan")',
        ]

        clicked = False
        for selector in floor_selectors:
            try:
                loc = page.locator(selector).first
                if loc.count() == 0:
                    continue
                try:
                    if not loc.is_visible(timeout=1500):
                        continue
                except Exception:
                    continue
                loc.scroll_into_view_if_needed(timeout=3000)
                loc.click(timeout=4000)
                self.log_msg(f"[план][listing] клик → Floor Plan ({selector})")
                clicked = True
                break
            except Exception:
                continue

        if not clicked:
            try:
                loc = page.get_by_text(re.compile(r"^\s*Floor\s*Plan\s*$", re.I)).first
                if loc.count() > 0 and loc.is_visible(timeout=1500):
                    loc.scroll_into_view_if_needed(timeout=3000)
                    loc.click(timeout=4000)
                    self.log_msg("[план][listing] клик по тексту «Floor Plan»")
                    clicked = True
            except Exception:
                pass

        if not clicked:
            self.log_msg("[план][listing] кнопку Floor Plan не нашёл — читаю DOM как есть")
        else:
            # раунд 53: было sleep(2.0) + wait_for_selector(8 с), который в логе
            # 15.33 всегда доживал до таймаута (13 с на шаге). Теперь опрос:
            # как только в DOM есть план этажа — идём дальше.
            _t_fp = time.time()
            time.sleep(0.6)
            while time.time() - _t_fp < 10.0:
                try:
                    if page.evaluate("""() => !!document.querySelector(
                        'img[src*="floor_map"], img[data-testid="floor-map-tile-image"], '
                        + '#floorplan-tab[aria-selected="true"]')
                        || document.documentElement.innerHTML.indexOf('floor_shape/') >= 0"""):
                        break
                except Exception:
                    pass
                time.sleep(0.3)
            # иногда нужен второй клик по вкладке Floor Plan внутри lightbox
            for selector in ('#floorplan-tab', 'button[aria-label="view floor plan"]', 'button[value="floorplan"]'):
                try:
                    loc = page.locator(selector).first
                    if loc.count() == 0:
                        continue
                    pressed = loc.get_attribute("aria-selected") or loc.get_attribute("aria-pressed")
                    if pressed in ("true", "True"):
                        break
                    loc.click(timeout=3000)
                    self.log_msg(f"[план][listing] переключил вкладку Floor Plan ({selector})")
                    time.sleep(1.5)
                    break
                except Exception:
                    continue
            time.sleep(0.3)

        # Раунд 40 (guide.txt + guide 2.txt): старый построчный читатель
        # карточной панели (_capture_interactive_floorplan_panel(page))
        # выключен — у него не тот контракт (он и ругался «floors — не
        # список пар»). Эталонные скрины планов делает гайд-поток на шаге
        # 2.5 НИЖЕ (сразу, как floorId'ы известны из URL): карточки этажей
        # сверху вниз, тумблер «3D Home» по цвету перед КАЖДЫМ кадром.
        # Загрузка планов — один раз после съёмки (замечание 1), а не
        # «перед скриншотами и ещё раз в конце».
        self._floorplan_captures = []
        refs_early = False

        # 2) URL-ы плана из DOM (hero.png в приоритете)
        try:
            html = page.evaluate("() => document.documentElement.outerHTML")
        except Exception:
            html = None
        urls = find_zillow_listing_floor_plan_urls(html) if html else []
        # дополнительно: прямой src у floor-map-tile-image
        try:
            extra = page.evaluate(
                """() => {
                    const imgs = Array.from(document.querySelectorAll(
                        'img[data-testid="floor-map-tile-image"], img[src*="floor_map"]'
                    ));
                    return imgs.map(i => i.src).filter(Boolean);
                }"""
            ) or []
            for u in extra:
                if u and u not in urls:
                    if "/hero." in u.lower():
                        urls.insert(0, u)
                    else:
                        urls.append(u)
        except Exception:
            pass

        self._listing_floor_plan_urls = urls
        if urls:
            self.log_msg(f"[план][listing] найдено URL плана: {len(urls)}")
            for u in urls[:5]:
                self.log_msg(f"[план][listing]   {u[:140]}")
        else:
            self.log_msg("[план][listing] URL плана в DOM не найдены")

        # ---- 2.5) Ранняя съёмка эталонов планов (гайд 4.1-4.4) — ДО
        # загрузки планов и панорам. floorId'ы — из URL floor_shape/.../
        # в порядке DOM = вертикальный порядок карточек = Floor 1..N.
        # Успех: showcase-страж по файлам ref_floor_*.png больше НЕ
        # заходит во Floor Plan в конце (замечание 1 — без «второго
        # раза»). ----
        _fpairs = []
        _seen_fid = []
        for u in (urls or []):
            m = re.search(r"/floor_shape/([0-9a-zA-Z_-]{6,32})(?:/|$)", u or "")
            if m and m.group(1) not in _seen_fid:
                _seen_fid.append(m.group(1))
                _fpairs.append((f"Floor {len(_seen_fid)}", m.group(1)))
        if _fpairs:
            try:
                _refs = self._capture_interactive_floorplan_panel(_fpairs)
                refs_early = bool(_refs)
                if _refs:
                    self._fplan_refs_key = (self._original_url,
                                            tuple(sorted(_seen_fid)))
                    self.log_msg(f"[план][listing] ранние эталоны планов: "
                                 f"{len(_refs)} шт (снято до загрузки планов)")
            except Exception as e:
                self.log_msg(f"[план][listing] ранняя съёмка планов не удалась: {e}")
        else:
            self.log_msg("[план][listing] в URL планов нет floor_shape id — "
                         "эталоны снимет этап showcase")
        if not refs_early:
            # Раунд 23 (схема пользователя): резервные слайды панели
            # ref_panel_* — только если гайд-поток не отснял
            try:
                self._screenshot_floorplan_panel_slides(page)
            except Exception as e:
                self.log_msg(f"[план][эталон] скриншоты панели не удались: {e}")

        # 3) Скачать файлы (hero.png → plan.png)
        downloaded = self._download_listing_floor_plans_from_urls(urls)

        # 4) Screenshot открытого вида — если hero.png не скачался
        plan_path = os.path.join(ARCHIVE_DIR, "plan.png")
        have_plan_png = os.path.exists(plan_path) and os.path.getsize(plan_path) > 1000
        if not have_plan_png:
            shot_ok = False
            screenshot_selectors = [
                'img[data-testid="floor-map-tile-image"]',
                'img[src*="floor_map"][src*="hero"]',
                'img[src*="/floor_map/"]',
                '#floorplan-panel',
                '[data-testid="floor-plan-thumbnail"]',
                'svg[viewBox]',
            ]
            for selector in screenshot_selectors:
                try:
                    loc = page.locator(selector).first
                    if loc.count() == 0:
                        continue
                    try:
                        if not loc.is_visible(timeout=1000):
                            continue
                    except Exception:
                        continue
                    box = loc.bounding_box()
                    if not box or box.get("width", 0) < 120 or box.get("height", 0) < 120:
                        continue
                    loc.screenshot(path=plan_path, type="png")
                    if os.path.exists(plan_path) and os.path.getsize(plan_path) > 1000:
                        shot_ok = True
                        self.log_msg(f"[план][listing] screenshot → plan.png ({selector})")
                        break
                except Exception as e:
                    self.log_msg(f"[план][listing] screenshot ({selector}): {e}")
            if shot_ok and "plan.png" not in downloaded:
                downloaded.insert(0, "plan.png")

        # 5) Если до сих пор нет растрового plan.png (не было hero.png, и
        # скриншот панели тоже не получился — например, потому что клик по
        # вкладке Floor Plan не сработал и панель не открылась визуально),
        # но есть скачанный compressed.svg — рендерим его в PNG тем же
        # Chrome, без новых зависимостей (cairosvg и т.п.): открываем файл
        # file:// в отдельной вкладке того же контекста и снимаем скриншот
        # самого <svg>. Это отдельный источник плана, независимый от того,
        # что видно на экране, поэтому срабатывает и тогда, когда шаг 4
        # выше не сработал. Нужно, потому что сторонние программы,
        # открывающие .3dview, обычно ждут растровый план, а не голый .svg
        # внутри архива (см. CONTEXT.md, п. B).
        have_plan_png = os.path.exists(plan_path) and os.path.getsize(plan_path) > 1000
        if not have_plan_png:
            svg_fname = next((f for f in downloaded if f.lower().endswith(".svg")), None)
            if svg_fname:
                svg_path = os.path.join(ARCHIVE_DIR, svg_fname)
                if self._rasterize_svg_to_png(page, svg_path, plan_path):
                    if "plan.png" not in downloaded:
                        downloaded.insert(0, "plan.png")

        self._listing_floor_plan_files = downloaded
        if downloaded:
            self.log_msg(f"[план][listing] готово до панорам: {', '.join(downloaded)}")
        else:
            self.log_msg("[план][listing] план с карточки получить не удалось")
        return downloaded

    def _screenshot_floorplan_panel_slides(self, page):
        """Раунд 23 — шаг 1 схемы ПОЛЬЗОВАТЕЛЯ автоматизирован: граббер сам
        делает СКРИНШОТ родного плана Zillow С СИНИМИ ТОЧКАМИ-КАМЕРАМИ —
        по одному на этаж открытой панели «Floor Plan» (слайды карусели).
        Файлы ref_panel_<подпись>.png / ref_panel_<номер>.png дальше
        подхватывает showcase-блок: находит точки по цвету, совмещает с
        нашим планом и ставит камеры точно на них. Возвращает список
        сохранённых файлов."""
        saved = []
        try:
            handles = page.query_selector_all(
                'ul[data-testid="basic-carousel"] > li[data-testid="carousel-item-li"]'
            )
            if not handles:
                surface = page.query_selector(
                    '[data-testid="pinchable-gesture-surface"]')
                if surface:
                    handles = [surface]
        except Exception as e:
            self.log_msg(f"[план][эталон] панель Floor Plan недоступна для скриншотов: {e}")
            return saved
        for i, el in enumerate(handles):
            try:
                try:
                    el.scroll_into_view_if_needed(timeout=4000)
                except Exception:
                    pass
                time.sleep(0.5)
                lbl = ""
                try:
                    lbl = (el.eval_on_selector(
                        "label", "n => (n.textContent || '').trim()") or "")
                except Exception:
                    lbl = ""
                nm = re.sub(r"[^a-z0-9а-яё]+", "", (lbl or "").lower())
                fname = f"ref_panel_{nm}.png" if nm else f"ref_panel_{i + 1}.png"
                path = os.path.join(ARCHIVE_DIR, fname)
                el.screenshot(path=path, timeout=8000)
                saved.append(fname)
                self.log_msg(
                    f"[план][эталон] скриншот родного плана с камерами: "
                    f"{fname} («{lbl or i + 1}»)"
                )
            except Exception as e:
                self.log_msg(
                    f"[план][эталон] этаж-слайд {i + 1}: скриншот не удался "
                    f"({type(e).__name__}: {e})"
                )
        return saved

    def _screenshot_tour_floor_views(self, page):
        """Схема пользователя (раунды 22-25): автоскриншоты видов этажей из
        3D-тура. Пустой список = схема не сошлась, работает запасной путь."""
        try:
            return self._screenshot_tour_floor_views_impl(page)
        except Exception as e:
            self.log_msg(f"[тур][эталон] неожиданная ошибка схемы тура: {e!r} — перехожу на запасной путь")
            return []

    def _screenshot_tour_floor_views_impl(self, page):
        saved = []

        # Раунд 40 (замечание 2: «сначала открываешь какой-попало этаж»):
        # если гайд-поток уже снял эталоны ref_floor_<floorId>.png (шаги
        # 4.1-4.4 на раннем этапе), в туре Floor Plan НЕ открываем — ни
        # клика внутрь, ни «этажа текущей камеры».
        try:
            if any(fn.startswith("ref_floor_") and fn.endswith(".png")
                   for fn in os.listdir(ARCHIVE_DIR)):
                self.log_msg("[тур][эталон] планы уже сняты рано (ref_floor_*.png) "
                             "— Floor Plan в туре не открываю")
                return saved
        except Exception:
            pass

        JS_TAB = r"""
        () => {
          const deepAll = (sel, root) => {
            let out = [];
            try { out = Array.from(root.querySelectorAll(sel)); } catch (e) {}
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) out = out.concat(deepAll(sel, el.shadowRoot));
            }
            return out;
          };
          const SEL = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], label, span, div';
          const excluded = (el) => {
            for (let p = el, d = 0; p && d < 12; p = p.parentElement, d++) {
              const t = (p.getAttribute && p.getAttribute('data-testid')) || '';
              if (/^(persistent-tab|action-bar|hero-|topnav|more-menu|floor-map|basic-carousel|share-button)/i.test(t)) return true;
            }
            return false;
          };
          // «Floors» в интерфейсе тура нет — переключатель этажей/плана
          // называется «Floor Plan» (в туре это и пилюля button[aria=
          // "view floor plan"]): ловим её тоже.
          const exact = /^(floors?|dollhouse|этажи?|((view|открыть)\s+)?floor\s*plan|план\s*этажей?)$/i;
          const cands = [];
          for (const el of deepAll(SEL, document)) {
            if (cands.length >= 50) break;
            const r = el.getBoundingClientRect();
            if (r.width < 5 || r.height < 5 || r.width > 900 || r.height > 400) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
            if (excluded(el)) continue;
            let own = '';
            for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
            own = own.replace(/\s+/g, ' ').trim();
            const aria = (el.getAttribute('aria-label') || '').trim();
            const title = (el.getAttribute('title') || '').trim();
            const tid = (el.getAttribute('data-testid') || '').replace(/\s+/g, ' ').trim();
            if (![own, aria, title, tid].some(t => t && exact.test(t))) continue;
            cands.push({ text: (own || aria || title || tid).slice(0, 60),
                         tag: el.tagName.toLowerCase(), testid: tid.slice(0, 50),
                         w: Math.round(r.width), h: Math.round(r.height),
                         dlg: el.closest && el.closest('dialog') ? 0 : 1, _el: el });
          }
          if (!cands.length) return { clicked: null, cands: [] };
          const pri = c => (c.text.toLowerCase() === 'floors' ? 0 : 1);
          // элементы ВНУТРИ открытого dialog (лайтбокс тура) всегда важнее
          cands.sort((a, b) => a.dlg - b.dlg || pri(a) - pri(b) || (a.w * a.h) - (b.w * b.h));
          const c = cands[0];
          try { c._el.click(); } catch (e) {}
          return { clicked: { text: c.text, tag: c.tag, testid: c.testid, w: c.w, h: c.h },
                   cands: cands.slice(0, 12).map(x => ({ text: x.text, tag: x.tag, testid: x.testid, w: x.w, h: x.h })) };
        }
        """
        JS_FLOORS = r"""
        () => {
          const deepAll = (sel, root) => {
            let out = [];
            try { out = Array.from(root.querySelectorAll(sel)); } catch (e) {}
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) out = out.concat(deepAll(sel, el.shadowRoot));
            }
            return out;
          };
          const rx = /^\s*(?:(?:1st|2nd|3rd|4th|5th|6th)\s+)?floors?\s*\d{0,2}\s*$/i;
          const out = [], seen = new Set();
          const SEL = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], li, span, div';
          for (const el of deepAll(SEL, document)) {
            if (out.length >= 200) break;
            const r = el.getBoundingClientRect();
            if (r.width < 5 || r.height < 5 || r.width > 800 || r.height > 200) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
            let own = '';
            for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
            own = own.replace(/\s+/g, ' ').trim();
            const tid = (el.getAttribute('data-testid') || '').replace(/\s+/g, ' ').trim();
            const label = own || tid;
            if (!label || !rx.test(label)) continue;
            if (/^\s*floors?\s*$/i.test(label)) continue;
            if (!/\d/.test(label) && !/(?:1st|2nd|3rd|4th|5th|6th)/i.test(label)) continue;
            const key = label.toLowerCase();
            if (!seen.has(key)) { seen.add(key); out.push({ text: label.slice(0, 40) }); }
          }
          return out;
        }
        """
        JS_CLICK_TEXT = r"""
        (needle) => {
          const deepAll = (sel, root) => {
            let out = [];
            try { out = Array.from(root.querySelectorAll(sel)); } catch (e) {}
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) out = out.concat(deepAll(sel, el.shadowRoot));
            }
            return out;
          };
          const want = String(needle || '').trim().toLowerCase();
          const SEL = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], li, span, div';
          for (const el of deepAll(SEL, document)) {
            const r = el.getBoundingClientRect();
            if (r.width < 5 || r.height < 5 || r.width > 900 || r.height > 300) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
            let own = '';
            for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
            own = own.replace(/\s+/g, ' ').trim();
            const tid = (el.getAttribute('data-testid') || '').trim();
            if (own.toLowerCase() !== want && tid.toLowerCase() !== want) continue;
            let click = el, depth = 0;
            while (click && depth < 8) {
              const c2 = getComputedStyle(click);
              const role = click.getAttribute('role') || '';
              const tag = click.tagName.toLowerCase();
              if (tag === 'button' || tag === 'a' || role === 'button' || role === 'tab' ||
                  role === 'menuitem' || role === 'option' || c2.cursor === 'pointer') break;
              click = click.parentElement; depth++;
            }
            try { (click || el).click(); return true; } catch (e) { return false; }
          }
          return false;
        }
        """
        JS_CHECKS = r"""
        () => {
          const deepAll = (sel, root) => {
            let out = [];
            try { out = Array.from(root.querySelectorAll(sel)); } catch (e) {}
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) out = out.concat(deepAll(sel, el.shadowRoot));
            }
            return out;
          };
          const done = [];
          const SEL = 'input[type="checkbox"], [role="checkbox"], [role="switch"], [role="menuitemcheckbox"], label';
          for (const el of deepAll(SEL, document)) {
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) continue;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
            let label = (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '');
            let p = el.parentElement;
            for (let i = 0; i < 2 && p; i++) { label += ' ' + (p.textContent || ''); p = p.parentElement; }
            const low = label.toLowerCase();
            const is3d = /(3d|tour)/i.test(low) && !/(photo|фото|picture)/i.test(low);
            const isPhoto = /(photo|фото|picture)/i.test(low) && !/(3d|tour)/i.test(low);
            if (!is3d && !isPhoto) continue;
            const state = (el.checked !== undefined) ? !!el.checked
                          : (el.getAttribute('aria-checked') === 'true');
            const want = is3d;
            if (state !== want) { try { el.click(); } catch (e) {} }
            done.push({ label: label.replace(/\s+/g, ' ').trim().slice(0, 60),
                        want: want, was: state, already: state === want });
          }
          return done;
        }
        """
        # Исчерпывающая диагностика: где живёт интерфейс тура
        JS_DIAG = r"""
        () => {
          const deepAll = (sel, root) => {
            let out = [];
            try { out = Array.from(root.querySelectorAll(sel)); } catch (e) {}
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) out = out.concat(deepAll(sel, el.shadowRoot));
            }
            return out;
          };
          const info = { shadowHosts: [], canvases: [], overlayText: '', floorEls: [] };
          const walk = (root) => {
            for (const el of root.querySelectorAll('*')) {
              if (el.shadowRoot) {
                if (info.shadowHosts.length < 30)
                  info.shadowHosts.push(el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''));
                walk(el.shadowRoot);
              }
            }
          };
          walk(document);
          for (const c of deepAll('canvas', document)) {
            if (info.canvases.length >= 15) break;
            const r = c.getBoundingClientRect();
            if (r.width < 50 || r.height < 50) continue;
            info.canvases.push(Math.round(r.width) + 'x' + Math.round(r.height));
          }
          let overlay = null, best = 0;
          for (const el of deepAll('[data-testid="mask-wrapper"], [data-testid*="showcase"], [data-testid*="tour"]', document)) {
            const r = el.getBoundingClientRect();
            if (r.width * r.height > best) { best = r.width * r.height; overlay = el; }
          }
          if (overlay) {
            try { info.overlayText = (overlay.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 2000); } catch (e) {}
          }
          const SEL = 'button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], label, span, div, [data-testid], [aria-label]';
          for (const el of deepAll(SEL, document)) {
            if (info.floorEls.length >= 40) break;
            const r = el.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) continue;
            let own = '';
            for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
            own = own.replace(/\s+/g, ' ').trim();
            const aria = (el.getAttribute('aria-label') || '').trim();
            const tid = (el.getAttribute('data-testid') || '').trim();
            if (!/floor/i.test(own + ' ' + aria + ' ' + tid)) continue;
            const chain = [];
            for (let p = el, d = 0; p && d < 4; p = p.parentElement, d++) {
              const t = (p.getAttribute && p.getAttribute('data-testid')) || '';
              if (t) chain.push(t);
            }
            info.floorEls.push(el.tagName.toLowerCase() + (tid ? '[' + tid + ']' : '') + ' "' + (own || aria).slice(0, 40) + '" ' +
                                Math.round(r.width) + 'x' + Math.round(r.height) + (chain.length ? ' ←' + chain.slice(0, 3).join('←') : ''));
          }
          return info;
        }
        """

        def _diag(where):
            for fr in self._tour_all_frames(page):
                try:
                    info = fr.evaluate(JS_DIAG)
                except Exception:
                    continue
                if not info:
                    continue
                url = ""
                try:
                    url = (fr.url or "")[:80]
                except Exception:
                    pass
                self.log_msg(f"[тур][эталон][диагностика] фрейм {url or '?'}: shadow-хостов: "
                             f"{len(info.get('shadowHosts') or [])}"
                             + (f" ({', '.join(info['shadowHosts'][:8])})" if info.get('shadowHosts') else ""))
                if info.get("canvases"):
                    self.log_msg("[тур][эталон][диагностика] canvas: " + ", ".join(info["canvases"]))
                if info.get("overlayText"):
                    self.log_msg("[тур][эталон][диагностика] видимый текст контейнера тура: «" +
                                 info["overlayText"].replace("\n", " | ")[:600] + "»")
                if info.get("floorEls"):
                    self.log_msg("[тур][эталон][диагностика] элементы со словом floor: " +
                                 " | ".join(info["floorEls"][:25]))
                return
            self.log_msg(f"[тур][эталон][диагностика] {where}: ни один фрейм не дал данных")

        # --- 1. вкладка «Floors»: точный текст, проникновение в Shadow DOM ---
        self.log_msg("[тур][эталон] жду вкладку «Floors» открытого тура (до 45 с, обход Shadow DOM)...")
        # раунд 74: вместо слепых 5 с — сразу опрос (ниже он и так ждёт до 45 с)
        time.sleep(1.0)
        tab_info = None
        deadline = time.time() + 45.0
        wake_at = time.time() + 8.0
        while time.time() < deadline:
            for dy in (620, 850, 400):
                try:
                    page.mouse.move(700, dy)
                except Exception:
                    pass
            if time.time() >= wake_at:
                # Уроки прогонов 12:01 и 12:14: слепые клики будильника открыли
                # фото-лайтбокс с пустой карточки; а карточные маркеры (Floor plan
                # div'ы, persistent-tab-floor_plan) не годятся — карточка носит их
                # сама, даже без всякого тура (на них gate и срабатывал ложно).
                # Единственный честный признак «тур на экране» — ОТКРЫТЫЙ диалог
                # imx-lightbox-modal.
                tour_open = False
                try:
                    tour_open = bool(page.evaluate(
                        "() => !!document.querySelector("
                        "'dialog[class*=\"imx-lightbox-modal\"], "
                        "[class*=\"imx-lightbox-modal\"]')"))
                except Exception:
                    pass
                if tour_open:
                    try:
                        page.mouse.click(505, 460)   # клик внутрь тура — показать панель
                        self.log_msg("[тур][эталон] кликнул внутрь тура, чтобы разбудить панель управления")
                    except Exception:
                        pass
                else:
                    self.log_msg("[тур][эталон] тур на странице не открыт — внутрь "
                                 "не кликаю (иначе откроются фото), жду «Floors» молча...")
                wake_at = time.time() + 12.0
            for fr in self._tour_all_frames(page):
                try:
                    res = fr.evaluate(JS_TAB)
                except Exception:
                    continue
                if res and res.get("clicked"):
                    tab_info = res
                    c = res["clicked"]
                    self.log_msg(f"[тур][эталон] нашёл и кликнул вкладку «{c.get('text')}» "
                                 f"(тег {c.get('tag')}, testid={c.get('testid') or '—'}, "
                                 f"{c.get('w')}x{c.get('h')})")
                    break
            if tab_info:
                break
            time.sleep(0.8)
        if not tab_info:
            self.log_msg("[тур][эталон] вкладку «Floors/Floor Plan» не нашёл за 45 с — "
                         "полная диагностика ниже")
            _diag("Floors")
            return saved

        # --- 2. список этажей --- (опрос ниже сам ждёт появления списка)
        time.sleep(0.5)
        floors = []
        for _ in range(12):
            for fr in self._tour_all_frames(page):
                try:
                    res = fr.evaluate(JS_FLOORS)
                except Exception:
                    continue
                if res:
                    floors = res
                    break
            if floors:
                break
            time.sleep(0.8)
        if not floors:
            self.log_msg("[тур][эталон] список этажей не прочитался — снимаю полную диагностику")
            _diag("этажи")
            return saved
        self.log_msg("[тур][эталон] этажи: " + ", ".join(f.get("text", "?") for f in floors))

        # --- 3. каждый этаж: клик, галочки, скриншот ---
        for idx, fl in enumerate(floors, start=1):
            label = fl.get("text", "")
            clicked = False
            for fr in self._tour_all_frames(page):
                try:
                    if fr.evaluate(JS_CLICK_TEXT, label):
                        clicked = True
                        break
                except Exception:
                    continue
            if not clicked:
                self.log_msg(f"[тур][эталон] этаж «{label}»: не смог кликнуть — пропускаю")
                continue
            time.sleep(1.6)
            for _ in range(3):
                applied = False
                for fr in self._tour_all_frames(page):
                    try:
                        res = fr.evaluate(JS_CHECKS)
                    except Exception:
                        continue
                    if res:
                        applied = True
                        if idx == 1:
                            for d in res[:6]:
                                self.log_msg(f"[тур][эталон] галочка «{d.get('label')}» → "
                                             f"{'вкл' if d.get('want') else 'выкл'}"
                                             + (" (уже стояла)" if d.get("already") else ""))
                        break
                if applied:
                    break
                time.sleep(0.8)
            time.sleep(1.0)
            name = f"ref_tour_floor{idx}.png"
            try:
                page.screenshot(path=os.path.join(ARCHIVE_DIR, name))
                saved.append(name)
                self.log_msg(f"[тур][эталон] «{label}»: скриншот сохранён → {name}")
            except Exception as e:
                self.log_msg(f"[тур][эталон] «{label}»: скриншот не удался: {e}")
        return saved

    def _shot_wide(self, obj, **kwargs):
        """15.24: если передан clip — расширяет его на 60 px в каждую сторону
        (Playwright снимает по координатам страницы и за пределами вьюпорта)
        и логирует геометрию. Без clip — прозрачный passthrough."""
        clip = kwargs.get("clip")
        if clip:
            try:
                pad = 200
                x = float(clip.get("x", 0)); y = float(clip.get("y", 0))
                w = float(clip.get("width", 0)); h = float(clip.get("height", 0))
                nx, ny = max(0.0, x - pad), max(0.0, y - pad)
                nclip = {"x": nx, "y": ny,
                         "width": w + (x - nx) + pad,
                         "height": h + (y - ny) + pad}
                self.log_msg("[план-интеракт] clip до: (%.0f,%.0f %.0fx%.0f) -> после: (%.0f,%.0f %.0fx%.0f)"
                             % (x, y, w, h, nclip["x"], nclip["y"], nclip["width"], nclip["height"]))
                kwargs["clip"] = nclip
            except Exception as e:
                self.log_msg("[план-интеракт] clip не расширен: %s" % e)
        return obj.screenshot(**kwargs)

    def _capture_interactive_floorplan_panel(self, floors):
        """Автоэталоны планов этажей ПО ГАЙДУ (guide.txt, раунд 39; поток
        переписан ровно по пошаговому описанию пользователя):
        1) страница объекта; 2) клик по плитке «Floor plan» в героя-карусели
        (вторая мини-фото, НЕ первая «3D tour»); 3) открывается медиа-лайтбокс
        (?imxlb=f,0) с таб-баром «Photos | Floor Plan | 3D Home»; в вкладке
        Floor Plan: сверху — вкладки, справа — переходы по этажам (карточки
        Floor_1..Floor_N, активная подсвечена), в центре — сам план, справа
        внизу плана — тумблеры «Photos» и «3D Home»; 4.1-4.4) для каждого
        этажа сверху вниз: клик по его карточке, включённым оставляем ТОЛЬКО
        тумблер «3D Home» (Photos — гасим), скриншот центрального плана ->
        ref_floor_<floorId>.png; 4.5) сопоставление с официальными SVG планов и
        поиск позиций камер делает блок «б2» в showcase-цикле; 5) после всех
        этажей кликаем вкладку «3D Home» — панорамы (скриншот «4 3d home»)
        дальше собирает основной конвейер.
        floors: [("Floor 1", floorId), ...] в порядке этажей.
        Возвращает dict floorId -> путь к PNG; при любом сбое — только лог + {}.
        Правила: Esc нет; page.wait_for_selector нет; клики только topmost
        (elementFromPoint) через page.mouse.click по координатам
        getBoundingClientRect с поправкой на сдвиг фрейма; обход всех фреймов
        (UI лайтбокса может жить в iframe imx-lightbox-modal); инпуты
        тумблеров offscreen — кликаем по видимой текстовой плашке; тумблер
        «3D Home» ВКЛЮЧАЕМ только по гайду 4.2 (запрет старого потока снят
        инструкцией пользователя)."""
        import hashlib

        result = {}
        # активная страница; резерв — вкладка сетевого слушателя (тот же target)
        page = (getattr(self, "_active_page", None)
                or getattr(self, "_network_watch_page", None))
        if page is None:
            self.log_msg("[план-интеракт] ОШИБКА: страница не найдена")
            return {}
        # до ЛЮБЫХ кликов валидируем аргумент: резервная точка вызова в
        # _open_and_capture_floor_plan передаёт сюда страницу вместо списка пар
        if not (isinstance(floors, (list, tuple)) and floors
                and all(isinstance(x, (list, tuple)) and len(x) == 2 and x[0] and x[1]
                        for x in floors)):
            self.log_msg("[план-интеракт] ОШИБКА: floors — не список пар "
                         "(\"Floor N\", floorId) — выхожу без кликов")
            return {}
        try:
            # ---- JS: элементы верхней шапки лайтбокса (вкладки). y < 30%
            # высоты отсекает всё остальное (тумблеры «3D Home» внизу плана).
            JS_TOP_TAB = """(re) => {
                const rx = new RegExp(re, 'i');
                for (const b of document.querySelectorAll(
                        'button, [role="button"], [role="tab"]')) {
                    const t = (b.textContent || '').replace(/\\s+/g, ' ').trim();
                    if (!rx.test(t)) continue;
                    const r = b.getBoundingClientRect();
                    if (r.width < 20 || r.height < 10) continue;
                    if (r.y > window.innerHeight * 0.3) continue;
                    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
                    const e = document.elementFromPoint(cx, cy);
                    if (!e || !(e === b || b.contains(e))) continue;
                    return {x: cx, y: cy, t: t};
                }
                return null;
            }"""

            # ---- JS: плитка «Floor plan» в героя-карусели страницы (шаг 3).
            # Подпись equals «Floor plan»; y > 25% отсекает одноимённую
            # вкладку шапки лайтбокса; меньший контейнер = сама плитка.
            JS_HERO_TILE = """() => {
                const rx = /^floor[\\s_-]?plan$/i;
                const cands = [];
                for (const b of document.querySelectorAll(
                        'button, a, [role="button"], [role="tab"], li')) {
                    const t = (b.textContent || '').replace(/\\s+/g, ' ').trim();
                    if (!rx.test(t)) continue;
                    const r = b.getBoundingClientRect();
                    if (r.width < 50 || r.height < 30) continue;
                    if (r.y < window.innerHeight * 0.25) continue;
                    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
                    const e = document.elementFromPoint(cx, cy);
                    if (!e || !(e === b || b.contains(e))) continue;
                    cands.push({x: cx, y: cy, area: r.width * r.height});
                }
                cands.sort((a, b) => a.area - b.area);
                return cands.length ? cands[0] : null;
            }"""

            # ---- JS: карточки переходов по этажам СПРАВА (шаг 4.1/4.4):
            # текст вида «Floor_2»/«Floor 2», правая треть окна, topmost,
            # по номеру дедуп (меньший контейнер = сама карточка), сортировка
            # сверху вниз. Резерв — тестid превью из старого тур-потока.
            JS_FLOOR_CARDS = """() => {
                const rx = /^floor[\\s_-]?(\\d+)$/i;
                const W = window.innerWidth;
                const cands = [];
                for (const el of document.querySelectorAll(
                        'button, [role="button"], [role="tab"], div, li')) {
                    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
                    const m = rx.exec(t);
                    if (!m) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width < 60 || r.height < 24) continue;
                    if (r.x + r.width / 2 < W * 0.55) continue;
                    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
                    const e = document.elementFromPoint(cx, cy);
                    if (!e || !(e === el || el.contains(e))) continue;
                    cands.push({num: +m[1], area: r.width * r.height,
                                x: cx, y: cy});
                }
                cands.sort((a, b) => a.area - b.area);
                const out = [], seen = new Set();
                for (const c of cands) {
                    if (seen.has(c.num)) continue;
                    seen.add(c.num);
                    out.push({num: c.num, x: c.x, y: c.y});
                }
                if (!out.length) {
                    for (const d of document.querySelectorAll(
                            'div[data-testid="floor-plan-thumbnail"]')) {
                        const r = d.getBoundingClientRect();
                        if (r.width <= 0 || r.height <= 0) continue;
                        out.push({num: 0, x: r.x + r.width / 2,
                                  y: r.y + r.height / 2});
                    }
                    out.sort((a, b) => a.y - b.y);
                    out.forEach((c, i) => { c.num = i + 1; });
                }
                return out;
            }"""

            # ---- JS: маркер «какой этаж сейчас открыт» + рамка центрального
            # плана: элемент с aria/aria-label «Floor plan for Floor N».
            JS_OPEN_FLOOR = """() => {
                for (const el of document.querySelectorAll(
                        '[aria^="Floor plan for Floor"], '
                        '[aria-label^="Floor plan for Floor"]')) {
                    const r = el.getBoundingClientRect();
                    if (r.width < 120 || r.height < 100) continue;
                    const s = (el.getAttribute('aria-label')
                               || el.getAttribute('aria') || '');
                    const m = s.match(/(\\d+)/);
                    return {n: m ? +m[1] : 0, x: r.x, y: r.y,
                            w: r.width, h: r.height};
                }
                return null;
            }"""

            # ---- JS: рамка плана резервом — самый большой svg/canvas ЛЕВОЙ
            # части окна (правый край > 72% — это сайдбар с мини-планами).
            JS_PLAN_BOX = """() => {
                let best = null;
                const W = window.innerWidth, H = window.innerHeight;
                for (const c of document.querySelectorAll('svg, canvas')) {
                    const r = c.getBoundingClientRect();
                    if (r.width < 250 || r.height < 180) continue;
                    if (r.x + r.width / 2 > W * 0.72) continue;
                    if (r.y > H - 40 || r.y + r.height < 40) continue;
                    if (!best || r.width * r.height > best.w * best.h)
                        best = {x: r.x, y: r.y, w: r.width, h: r.height};
                }
                return best;
            }"""

            # ---- JS: тумблер по подписи («Photos» / «3D Home») в НИЖНЕЙ
            # половине плана (y > 40%): инпут checkbox offscreen — читаем его
            # .checked, кликаем по видимой плашке-обёртке с текстом.
            JS_TOGGLE_TEXT = """(lbl) => {
                const rx = new RegExp('^' + lbl + '$', 'i');
                const H = window.innerHeight;
                const blue = (s) => {
                    const m = String(s || '').match(
                        /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
                    if (!m) return false;
                    const R = +m[1], G = +m[2], B = +m[3];
                    return B > 150 && B > R + 40 && B > G + 25;
                };
                let hit = null;
                for (const el of document.querySelectorAll(
                        'label, span, div, button, p')) {
                    const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
                    if (!rx.test(t)) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width < 10 || r.height < 6) continue;
                    if (r.y < H * 0.35) continue;
                    const e = document.elementFromPoint(
                        r.x + r.width / 2, r.y + r.height / 2);
                    if (!e || !(e === el || el.contains(e))) continue;
                    hit = el; break;
                }
                if (!hit) return null;
                const lr = hit.getBoundingClientRect();
                // пилюля-переключатель: маленькая скруглённая плашка СПРАВА
                // от подписи. Кликать надо по ней (по тексту тумблер часто
                // не переключается), а состояние читать по БЕГУНКУ: белый
                // кружок справа = ВКЛ (как «5 3dhome open»), слева = ВЫКЛ
                // (серый, как «6 3dhome closed»); синий фон трека — резерв.
                let track = null, trackEl = null;
                let row = hit.closest('label') || hit.parentElement;
                for (let up = 0; up < 3 && row; up++) {
                    for (const n of row.querySelectorAll('span, div, i, button')) {
                        const rr = n.getBoundingClientRect();
                        if (rr.width < 22 || rr.width > 110) continue;
                        if (rr.height < 10 || rr.height > 50) continue;
                        if (rr.x < lr.right - 14) continue;
                        const cy = rr.y + rr.height / 2;
                        if (cy < lr.y - rr.height || cy > lr.bottom + rr.height)
                            continue;
                        const cs = getComputedStyle(n);
                        const br = parseFloat(cs.borderRadius) || 0;
                        if (br < 6 && !blue(cs.backgroundColor)) continue;
                        if (!track || rr.width * rr.height < track.w * track.h) {
                            track = {x: rr.x + rr.width / 2, y: cy,
                                     w: rr.width, h: rr.height, left: rr.x,
                                     blue: blue(cs.backgroundColor)};
                            trackEl = n;
                        }
                    }
                    if (track) break;
                    row = row.parentElement;
                }
                let inpFound = false, relVal = null;
                const votes = {};
                // раунд 49: собираем голоса ВСЕХ источников независимо;
                // итог = ИЛИ (ложное «вкл» безопасно — клик не делается,
                // ложное «выкл» опасно — выключает включённое)
                let inp = null, anc = hit;
                try {
                    const lb = anc.closest('label');
                    if (lb) inp = lb.querySelector('input[type="checkbox"]');
                } catch(e) {}
                for (let up = 0; up < 4 && !inp && anc; up++) {
                    anc = anc.parentElement;
                    try {
                        if (anc && anc.querySelector)
                            inp = anc.querySelector('input[type="checkbox"]');
                    } catch(e) {}
                }
                inpFound = !!inp;
                if (inp) votes.checkbox = !!inp.checked;
                try {
                    const sw = (trackEl && trackEl.closest('[aria-checked]')) ||
                               hit.closest('[aria-checked]');
                    if (sw) votes.aria = sw.getAttribute('aria-checked') === 'true';
                } catch(e) {}
                if (trackEl && track) {
                    let bcx = null, bw = 0;
                    for (const n of trackEl.querySelectorAll('*')) {
                        const rr = n.getBoundingClientRect();
                        if (rr.width < 6 || rr.width > track.w) continue;
                        if (Math.abs(rr.width - rr.height) > 10) continue;
                        if (rr.width > bw) { bw = rr.width; bcx = rr.x + rr.width / 2; }
                    }
                    if (bcx !== null && track.w > 0) {
                        const rel = (bcx - track.left) / track.w;
                        relVal = rel;
                        if (rel > 0.55) votes.thumb = true;
                        else if (rel < 0.45) votes.thumb = false;
                    }
                    votes.blue = track.blue;
                }
                let on = null;
                const trues = [], falses = [];
                for (const k in votes) {
                    if (votes[k] === true) trues.push(k);
                    else if (votes[k] === false) falses.push(k);
                }
                if (trues.length) on = true;
                else if (falses.length) on = false;
                const srcUsed = trues.length ? ('OR:' + trues.join('+'))
                                             : (falses.length ? falses.join('+') : 'none');
                return {x: track ? track.x : lr.x + lr.width / 2,
                        y: track ? track.y : lr.y + lr.height / 2, on: on,
                        src: srcUsed, inp: inpFound, rel: relVal,
                        blue: track ? track.blue : null, votes: votes};
            }"""

            def _frame_map():
                # [(frame, dx, dy)] — левый верхний угол фрейма во вьюпорте
                # страницы (bounding_box хоста <iframe> уже учитывает вложенность)
                out = []
                try:
                    frames = list(page.frames)
                    main = page.main_frame
                except Exception:
                    return out
                for fr in frames:
                    fdx = fdy = 0.0
                    try:
                        if fr is not main:
                            bb = fr.frame_element().bounding_box()
                            if bb:
                                fdx, fdy = float(bb["x"]), float(bb["y"])
                    except Exception:
                        fdx = fdy = 0.0
                    out.append((fr, fdx, fdy))
                return out

            def _ev(fr, js, arg=None):
                try:
                    return fr.evaluate(js, arg)
                except Exception:
                    return None

            def _ev_any(js, arg=None):
                """первый фрейм, где js вернул непустое -> (frame, dx, dy, value)"""
                for fr, fdx, fdy in _frame_map():
                    v = _ev(fr, js, arg)
                    if v:
                        return fr, fdx, fdy, v
                return None, 0.0, 0.0, None

            def _plan_state():
                """(frame, dx, dy, cards, plan_box) — план-вид открыт, если в
                каком-то фрейме есть карточки переходов по этажам."""
                for fr, fdx, fdy in _frame_map():
                    cards = _ev(fr, JS_FLOOR_CARDS) or []
                    if cards:
                        return fr, fdx, fdy, cards, (_ev(fr, JS_OPEN_FLOOR)
                                                     or _ev(fr, JS_PLAN_BOX))
                return None, 0.0, 0.0, [], None

            def _wait_plan(timeout_s):
                end = time.time() + timeout_s
                while True:
                    st = _plan_state()
                    if st[3] or time.time() >= end:
                        return st
                    time.sleep(0.4)  # раунд 54: было 1.0

            def _set_toggle(fr, ox, oy, name, want):
                """15.25: поиск — родной _ev/JS_TOGGLE_TEXT. ОДИН клик; после него
                пауза 4.0 с (раунд 42: UI применяет состояние за 2-3 с) и одна перечитка
                ТОЛЬКО для лога — подтверждение НЕ блокирует съёмку. Повторных кликов
                НЕТ: второй клик отменяет отложенное переключение, а при вручную
                включённом «3D Home» — выключает его (читалка on у этой пилюли врёт —
                доказано логом 15.24: синие точки на эталонах есть, on всё равно False)."""
                if isinstance(want, str):
                    want = want.strip().lower() in ("вкл", "on", "true", "1", "yes", "да", "enable")
                else:
                    want = bool(want)
                page = getattr(fr, "page", fr)
                if name == "3D Home" and getattr(self, "_tdhome_clicked", False):
                    self.log_msg("[план-интеракт] «3D Home» уже ставился в этом прогоне — НЕ трогаю: читалка врёт False, повторный клик выключит режим")
                    return True

                def _read():
                    try:
                        return _ev(fr, JS_TOGGLE_TEXT, name)
                    except Exception as e:
                        self.log_msg("[план-интеракт] «%s» ошибка чтения состояния: %s" % (name, e))
                        return None

                st = _read()
                if not st:
                    self.log_msg("ВНИМАНИЕ: тумблер «%s» не найден — продолжаю без клика" % name)
                    return False
                if st.get("on") is want:
                    self.log_msg("[план-интеракт] «%s» уже %s — не трогаю" % (name, "вкл" if want else "выкл"))
                    return True
                self.log_msg("[план-интеракт] «%s» состояние перед кликом (диагностика читалки): %s" % (name, st))
                px_, py_ = st["x"] + ox, st["y"] + oy
                page.mouse.click(px_, py_)  # ЕДИНСТВЕННЫЙ клик на этот тумблер за прогон
                if name == "3D Home":
                    self._tdhome_clicked = True
                self.log_msg("[план-интеракт] «%s» -> %s (клик @(%d,%d))"
                             % (name, "вкл" if want else "выкл", int(px_), int(py_)))
                # раунд 54: у «Photos» читалка честная — опрашиваем и идём
                # дальше сразу после подтверждения (было всегда 4.0 с)
                _t_click = time.time()
                st2 = None
                if name == "3D Home":
                    time.sleep(4.0)
                    st2 = _read()
                else:
                    time.sleep(0.6)
                    while time.time() - _t_click < 4.0:
                        st2 = _read()
                        if st2 and st2.get("on") is want:
                            break
                        time.sleep(0.3)
                if st2 and st2.get("on") is want:
                    self.log_msg("[план-интеракт] «%s» подтвердился через %.1f с" % (name, time.time() - _t_click))
                else:
                    self.log_msg("[план-интеракт] «%s» после клика читалка видит on=%s — съёмку НЕ блокирую, "
                                 "повторных кликов НЕТ" % (name, st2.get("on") if st2 else None))
                return True
            # ---- шаг 3 (гайд): открыть Floor Plan. Уже открыт — не трогаем
            # вход; лайтбокс с фото открыт — жмём вкладку «Floor Plan» сверху;
            # иначе кликаем плитку «Floor plan» в героя-карусели; дальше
            # page.click-резерв и прямой переход по ?imxlb=f,0.
            fr_t, dx, dy, cards, pbox = _plan_state()
            if not cards:
                ft, ftx, fty, tab = _ev_any(JS_TOP_TAB, r"^Floor[\s_-]?Plan$")
                if tab:
                    page.mouse.click(tab["x"] + ftx, tab["y"] + fty)
                    self.log_msg(f"[план-интеракт] кликнул вкладку «{tab['t']}» в "
                                 f"шапке лайтбокса @({int(tab['x'] + ftx)},"
                                 f"{int(tab['y'] + fty)}) — открываю план")
                else:
                    fh, dhx, dhy, tile = _ev_any(JS_HERO_TILE)
                    if tile:
                        page.mouse.click(tile["x"] + dhx, tile["y"] + dhy)
                        self.log_msg("[план-интеракт] кликнул плитку «Floor plan» в "
                                     f"герое страницы @({int(tile['x'] + dhx)},"
                                     f"{int(tile['y'] + dhy)}) — открываю план "
                                     "(первая плитка «3D tour» не тронута)")
                    else:
                        opened = False
                        try:
                            page.click('button:has-text("Floor plan")', timeout=3500)
                            opened = True
                            self.log_msg("[план-интеракт] плитка не найдена topmost — "
                                         "кликнул button:has-text(\"Floor plan\")")
                        except Exception:
                            pass
                        if not opened:
                            try:
                                u = getattr(page, "url", None)
                                if isinstance(u, str) and "zillow.com" in u:
                                    page.goto(u.split("?")[0] + "?imxlb=f,0",
                                              wait_until="domcontentloaded",
                                              timeout=30000)
                                    self.log_msg("[план-интеракт] ни плитки, ни "
                                                 "вкладки — иду напрямую по "
                                                 "?imxlb=f,0")
                            except Exception:
                                pass
                fr_t, dx, dy, cards, pbox = _wait_plan(15.0)
            if not cards:
                self.log_msg("[план-интеракт] ОШИБКА: план-вкладка не открылась "
                             "(карточки переходов по этажам справа не появились) — "
                             "выхожу без съёмки")
                return {}
            if len(cards) < len(floors):
                self.log_msg(f"[план-интеракт] ОШИБКА: карточек этажей "
                             f"{len(cards)}, а этажей {len(floors)} — выхожу")
                return {}
            cards = cards[:len(floors)]
            self.log_msg(f"[план-интеракт] Floor Plan открыт, карточек этажей: "
                         f"{len(cards)} (порядок сверху вниз = Floor 1..N)")
            time.sleep(1.2)

            # состояние «Photos» до нас — по нему решаем, возвращать ли (шаг 4.2
            # требует Photos ВЫКЛ на время съёмки)
            tp0 = _ev(fr_t, JS_TOGGLE_TEXT, "Photos")
            photos_initial = tp0.get("on") if tp0 else None

            def _dots_on_screen():
                """Раунд 52: читалка «3D Home» по ПИКСЕЛЯМ — сколько синих точек
                видно на плане (checkbox врёт в обоих состояниях)."""
                try:
                    pb = _ev(fr_t, JS_OPEN_FLOOR) or _ev(fr_t, JS_PLAN_BOX)
                    if not pb:
                        return None
                    clip = {"x": max(0.0, pb["x"] + dx - 8.0), "y": max(0.0, pb["y"] + dy - 8.0),
                            "width": float(pb["w"]) + 16.0, "height": float(pb["h"]) + 16.0}
                    probe = os.path.join(ARCHIVE_DIR, "_probe_3dhome.png")
                    self._shot_wide(page, path=probe, clip=clip)
                    n = len(self._detect_blue_dots_pil(probe, area=self._wall_bbox_px(probe)))
                    try:
                        os.remove(probe)
                    except Exception:
                        pass
                    return n
                except Exception as e:
                    self.log_msg(f"[план-интеракт] проба точек не удалась: {e}")
                    return None

            def _ensure_3dhome():
                if getattr(self, "_tdhome_clicked", False) or getattr(self, "_tdhome_ok", False):
                    return
                time.sleep(1.5)
                n0 = _dots_on_screen()
                if n0:
                    self._tdhome_ok = True
                    self.log_msg(f"[план-интеракт] «3D Home» уже вкл — на плане синих точек: {n0} "
                                 "(читаю по пикселям), НЕ кликаю")
                    return
                self.log_msg(f"[план-интеракт] «3D Home»: синих точек на плане {n0} — режим выкл, "
                             "включаю одним кликом")
                _set_toggle(fr_t, dx, dy, "3D Home", True)
                n1 = _dots_on_screen()
                if n1:
                    self._tdhome_ok = True
                    self.log_msg(f"[план-интеракт] «3D Home» включён — точек: {n1}")
                else:
                    self.log_msg(f"[план-интеракт] ВНИМАНИЕ: после клика точек {n1} — повторно "
                                 "не кликаю; позиции возьму из модели imx")

            def _plan_sig():
                """Раунд 53: быстрый отпечаток центрального плана (JPEG низкого
                качества → md5) — по нему видно, что этаж сменился и точки
                дорисовались, без фиксированных пауз."""
                try:
                    pb = _ev(fr_t, JS_OPEN_FLOOR) or _ev(fr_t, JS_PLAN_BOX)
                    if not pb:
                        return None
                    clip = {"x": max(0.0, pb["x"] + dx), "y": max(0.0, pb["y"] + dy),
                            "width": max(1.0, float(pb["w"])), "height": max(1.0, float(pb["h"]))}
                    return hashlib.md5(page.screenshot(clip=clip, type="jpeg", quality=35)).hexdigest()
                except Exception:
                    return None

            def _wait_plan_settled(sig_before, max_s=4.0, min_s=0.5):
                """Ждём, пока план сменится (если sig_before задан) и два кадра
                подряд совпадут. Возвращает затраченные секунды."""
                t0 = time.time()
                time.sleep(min_s)
                changed = sig_before is None
                last = None
                while time.time() - t0 < max_s:
                    sg = _plan_sig()
                    if sg is None:
                        time.sleep(0.4)
                        continue
                    if sg != sig_before:
                        changed = True
                    if changed and sg == last:
                        break
                    last = sg
                    time.sleep(0.3)
                return time.time() - t0

            # ---- шаги 4.1-4.4: каждый этаж -> только «3D Home» вкл -> скрин
            hashes = {}
            for (label, floor_id), card in zip(floors, cards):
                try:
                    _t_floor = time.time()
                    _sig_before = _plan_sig() if hashes else None
                    page.mouse.click(card["x"] + dx, card["y"] + dy)
                    # 4.1: какой этаж реально открылся (маркер aria), резерв —
                    # доверие вертикальному порядку (надёжен, урок раунда 36).
                    # Раунд 53: у Zillow маркер номера этажа обычно пуст — раньше
                    # это стоило полных 6 + 1.2 с на КАЖДЫЙ этаж. Нет номера за
                    # 1.2 с — дальше ждём по самой картинке плана.
                    mnum = re.search(r"(\d+)", str(label))
                    want = int(mnum.group(1)) if mnum else 0
                    got = None
                    end = time.time() + 6.0
                    while time.time() < end:
                        ab = _ev(fr_t, JS_OPEN_FLOOR)
                        if ab and ab.get("n"):
                            got = int(ab["n"])
                            if got == want:
                                break
                        elif time.time() - _t_floor > 1.2:
                            break
                        time.sleep(0.3)
                    if want and got is not None and got != want:
                        self.log_msg(f"[план-интеракт] ВНИМАНИЕ: после карточки "
                                     f"«Floor {card.get('num')}» открыт план {got}, "
                                     f"ожидался {want} — съёмку не прерываю")
                    # 4.2 (гайд-2): ПЕРЕД КАЖДЫМ кадром — «Photos» в выкл,
                    # «3D Home» в вкл; клик по пилюле, проверка, повтор
                    _set_toggle(fr_t, dx, dy, "Photos", False)
                    _ensure_3dhome()
                    # раунд 53: вместо фиксированных 2 с — до смены и
                    # успокоения картинки (точки дорисовываются после смены)
                    _wait_plan_settled(_sig_before)
                    pbox = (_ev(fr_t, JS_OPEN_FLOOR) or _ev(fr_t, JS_PLAN_BOX)
                            or pbox)
                    if not pbox:
                        self.log_msg(f"[план-интеракт] {label}: центральный план не "
                                     "найден — этаж пропущен")
                        continue
                    clip = {"x": max(0.0, pbox["x"] + dx - 8.0),
                            "y": max(0.0, pbox["y"] + dy - 8.0),
                            "width": float(pbox["w"]) + 16.0,
                            "height": float(pbox["h"]) + 16.0}
                    path = os.path.join(ARCHIVE_DIR, f"ref_floor_{floor_id}.png")
                    self._shot_wide(page, path=path, clip=clip)
                    self._prefetch_ref_analysis(path)  # раунд 54
                    with open(path, "rb") as f:
                        md5 = hashlib.md5(f.read()).hexdigest()
                    hashes[floor_id] = md5
                    result[floor_id] = path
                    self.log_msg(f"[план-интеракт] {label} -> ref_floor_{floor_id}.png "
                                 f"(md5 {md5[:10]}, {time.time() - _t_floor:.1f} с)")
                except Exception as e:
                    self.log_msg(f"[план-интеракт] {label}: сбой — {e}")
            if not result:
                self.log_msg("[план-интеракт] ОШИБКА: ни одного эталона снять не "
                             "удалось")
                return {}
            if len(set(hashes.values())) != len(hashes):
                self.log_msg("[план-интеракт] ВНИМАНИЕ: одинаковые кадры — проверь "
                             "маппинг карточка↔этаж!")

            # раунд 53: «Photos» после съёмки НЕ возвращаем (лишний клик + 4 с
            # ожидания) — сразу к панорамам. photos_initial только для лога.
            if photos_initial:
                self.log_msg("[план-интеракт] «Photos» оставляю выкл — на панорамы не влияет")

            # ---- шаг 5 (гайд): вкладка «3D Home» — панорамы, их собирает
            # основной конвейер ([тур][эталон] и загрузка imxlb=t)
            f5, d5x, d5y, tab5 = _ev_any(JS_TOP_TAB, r"^3D Home$")
            if tab5:
                page.mouse.click(tab5["x"] + d5x, tab5["y"] + d5y)
                time.sleep(1.0)  # раунд 53: было 3.0 — модель imx уже перехвачена
                self.log_msg("[план-интеракт] перешёл на вкладку «3D Home» "
                             "(панорамы) — дальше основной конвейер")
            else:
                self.log_msg("[план-интеракт] ВНИМАНИЕ: вкладка «3D Home» в шапке "
                             "не нашлась — оставляю Floor Plan открытым")

            self.log_msg(f"[план-интеракт] готово: {len(result)} эталонов")
            return result
        except Exception as e:
            self.log_msg(f"[план-интеракт] ОШИБКА: {e}")
            return {}

    def _tour_all_frames(self, page):
        """Все фреймы рекурсивно (iframe тура может быть вложен и появиться позже)."""
        frames = []
        try:
            stack = [page.main_frame]
            while stack:
                fr = stack.pop()
                if fr is None:
                    continue
                frames.append(fr)
                try:
                    stack.extend(fr.child_frames or [])
                except Exception:
                    pass
        except Exception:
            pass
        return frames

    def _tour_dump_diagnostics(self, page, js_dump):
        """Аварийная диагностика: скриншот каждой задействованной страницы +
        дамп кликабельных элементов каждого фрейма в лог — чтобы следующий
        фикс селекторов делать по реальной разметке, а не вслепую."""
        pages_seen, ids = [], set()
        for fr in self._tour_all_frames(page):
            try:
                pg = fr.page
            except Exception:
                continue
            if pg is None or id(pg) in ids:
                continue
            ids.add(id(pg))
            pages_seen.append(pg)
        for i, pg in enumerate(pages_seen, start=1):
            try:
                name = f"debug_tour_page{i}.png"
                pg.screenshot(path=os.path.join(ARCHIVE_DIR, name))
                self.log_msg(f"[тур][эталон][диагностика] скриншот страницы {i} → {name}")
            except Exception as e:
                self.log_msg(f"[тур][эталон][диагностика] скриншот страницы {i} не удался: {e}")
        dumped = 0
        for fr in self._tour_all_frames(page):
            try:
                items = fr.evaluate(js_dump)
            except Exception:
                continue
            if isinstance(items, dict):
                try:
                    self.log_msg("[тур][эталон][диагностика] " +
                                 json.dumps(items, ensure_ascii=False)[:1500])
                except Exception:
                    pass
                continue
            if items:
                url = ""
                try:
                    url = (fr.url or "")[:100]
                except Exception:
                    pass
                self.log_msg(f"[тур][эталон][диагностика] фрейм {url or '?'}: " + " | ".join(items[:40]))
                dumped += 1
        if not dumped:
            self.log_msg("[тур][эталон][диагностика] кликабельных элементов нет ни в одном "
                         "фрейме (тур не отрисовался?)")
    def _rasterize_plan_svgs_from_captures(self, page, captures):
        """Сохраняет чертёж каждого этажа (inline SVG, снятый с панели
        Floor Plan в _capture_interactive_floorplan_panel) в архив и
        растеризует его же Chrome'ом в PNG РОВНО ПО АСПЕКТУ viewBox:
        в корень SVG вшиваются width/height, производные от viewBox, поэтому
        отрисовка без letterbox и перевод «метры → пиксели» прямой:
            px = (X - vbX) / vbW * ширина_PNG;   py = (Y - vbY) / vbH * высота_PNG.
        Размер PNG известен заранее (мы сами его задали), Pillow используется
        только для КОНТРОЛЯ фактического размера (метод _get_image_pixel_size;
        если Pillow не установлен — шаг контроля просто пропускается, как и у
        _annotate_zillow_plans/_draw_zillow_angle_schematic). Заполняет в
        captures поля svg_file/png_file/png_w/png_h. Одиночный этаж сразу
        растеризуется в plan.png (главный план архива), многоэтажный — в
        plan_panel_<этаж>.png на каждый этаж."""
        caps = [c for c in (captures or []) if c.get("viewbox") and c.get("svg_html")]
        multi = len(caps) > 1
        for cap in caps:
            vb = cap["viewbox"]
            try:
                vb_w, vb_h = float(vb[2]), float(vb[3])
            except Exception:
                continue
            if vb_w <= 0 or vb_h <= 0:
                continue
            w = 1600
            h = max(1, int(round(w * vb_h / vb_w)))
            # вшить размер в корень SVG: страница file:// отрисует элемент
            # ровно такого размера — скриншот получится без letterbox
            m = re.search(r"<svg[^>]*>", cap["svg_html"])
            if not m:
                continue
            root_tag = re.sub(r'\s(?:width|height)="[^"]*"', "", m.group(0))
            root_tag = root_tag[:-1] + f' width="{w}" height="{h}">'
            svg_final = cap["svg_html"][: m.start()] + root_tag + cap["svg_html"][m.end():]

            label = safe_filename(cap.get("label") or "floor") or "floor"
            fname_svg = f"plan_panel_{label}.svg" if multi else "plan_panel.svg"
            fname_png = f"plan_panel_{label}.png" if multi else "plan.png"
            svg_path = os.path.join(ARCHIVE_DIR, fname_svg)
            try:
                with open(svg_path, "w", encoding="utf-8") as f:
                    f.write(svg_final)
            except Exception as e:
                self.log_msg(f"[план][панель] не удалось сохранить {fname_svg}: {e}")
                continue
            cap["svg_file"] = fname_svg

            png_path = os.path.join(ARCHIVE_DIR, fname_png)
            if not self._rasterize_svg_to_png(page, svg_path, png_path, size=w):
                continue
            cap["png_file"] = fname_png
            cap["png_w"], cap["png_h"] = w, h
            self.log_msg(
                f"[план][панель] этаж «{cap.get('label') or '?'}»: {fname_svg} → {fname_png} "
                f"({w}x{h}, аспект = аспекту viewBox {vb_w:.2f}x{vb_h:.2f} м)"
            )
            # контроль фактического размера PNG (расхождение — признак
            # неожиданного CSS; тогда считаем по фактическому размеру)
            dims = self._get_image_pixel_size(png_path)
            if dims and (int(dims[0]), int(dims[1])) != (w, h):
                self.log_msg(
                    f"[план][панель] ВНИМАНИЕ: {fname_png} фактически "
                    f"{dims[0]}x{dims[1]}, ожидалось {w}x{h} — использую фактический размер"
                )
                cap["png_w"], cap["png_h"] = int(dims[0]), int(dims[1])

    def _bake_svg_width_height(self, svg_path, width=1600):
        """Вшивает в корневой тег SVG файла явные width/height, производные
        от viewBox (высота = round(width * vbH / vbW)), и возвращает
        (width, height, viewbox). После этого Chrome отрисовывает файл ровно
        в этом размере — без letterbox и без дефолтных 300x150, которые
        бывают у <svg> без размеров (план, растеризованный «как есть» в
        прошлом прогоне, страдал именно этим). Размер нужен заранее
        известным, чтобы переводить метры viewBox в пиксели PNG."""
        try:
            with open(svg_path, "r", encoding="utf-8") as f:
                text = f.read()
        except Exception as e:
            self.log_msg(f"[план][showcase] не удалось читать {os.path.basename(svg_path)}: {e}")
            return None
        m = re.search(r"<svg\b[^>]*>", text)
        if not m:
            self.log_msg(f"[план][showcase] в {os.path.basename(svg_path)} нет тега <svg>")
            return None
        mv = re.search(
            r'viewBox="\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s*"',
            m.group(0),
        )
        if not mv:
            self.log_msg(f"[план][showcase] в {os.path.basename(svg_path)} нет viewBox")
            return None
        try:
            vb = [float(v) for v in mv.groups()]
        except ValueError:
            return None
        if not vb[2] or not vb[3]:
            return None
        w = int(width)
        h = max(1, int(round(w * vb[3] / vb[2])))
        root = re.sub(r'\s(?:width|height)="[^"]*"', "", m.group(0))
        root = root[:-1] + f' width="{w}" height="{h}">'
        text = text[: m.start()] + root + text[m.end():]
        try:
            with open(svg_path, "w", encoding="utf-8") as f:
                f.write(text)
        except Exception as e:
            self.log_msg(f"[план][showcase] не удалось записать {os.path.basename(svg_path)}: {e}")
            return None
        return (w, h, vb)

    def _parse_floorplan_svg_geometry(self, svg_text):
        """Разбирает официальный SVG плана этажа Zillow
        (floor_map/<guid>/floor_shape/<floorId>/compressed.svg — он же
        showcase.floors[].primarySvgSource, он же то, что Zillow рисует на
        интерактивной панели Floor Plan).

        Возвращает dict:
            "viewbox":   [vbX, vbY, vbW, vbH] — система координат в МЕТРАХ;
            "meta":      атрибуты калибровки <g id="meta"> (data-scale-x/y,
                         data-offset-x/y, data-bounds-*) — перевод «сырных»
                         мировых координат модели (как их отдаёт
                         vrmodels/imx_*.json) в метры SVG:
                         svg = raw * scale + offset (у data-scale-y знак уже
                         отрицательный — флип оси Y вшит в него);
            "notes":     {id: {"data_room": str|None, "centroid": (cx, cy)}}
                         — группы <g id="..." class="note" data-room="...">
                         с прямоугольником площади комнаты
                         (polygon.dimensionsArea); ПРОВЕРЕНО на реальном
                         объявлении (18765 Labrador St): id заметок совпал
                         с rooms[].floorMapRoomId / значениями
                         allPanosToRooms в 18/18 случаях;
            "roomshapes":{id: {"centroid": (cx, cy)}} — полигоны комнат
                         (class="roomShape"), id — внутренние, связаны с
                         комнатой через note.data_room.

        ВАЖНО про ось Y: в файле вся геометрия лежит внутри
        <g transform="scale(1,-1)">, т.е. ОТРИСОВАННАЯ координата
        y_rendered = -y_poly. Проверено на реальном объявлении: с флипом
        16/16 точек панели попадают в полигоны комнат, а центроиды notes
        сходятся с реальными положениями точек панорам в 0.3-1.0 м; без
        флипа — систематический промах (~2 м). Центроиды хранятся здесь в
        СЫРЫХ координатах полигонов; флип делает
        _room_center_meters_from_geometry()."""
        geom = {"viewbox": None, "meta": {}, "notes": {}, "roomshapes": {}, "notetexts": {}}
        try:
            mv = re.search(
                r'<svg[^>]*viewBox="\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s*"',
                svg_text,
            )
            if mv:
                geom["viewbox"] = [float(v) for v in mv.groups()]
            mm = re.search(r'<g id="meta"([^>]*)>', svg_text)
            if mm:
                for k, v in re.findall(r'(data-[\w-]+)="([^"]*)"', mm.group(1)):
                    try:
                        geom["meta"][k] = float(v)
                    except ValueError:
                        pass

            def centroid(points_str):
                coords = [tuple(map(float, p.split(","))) for p in points_str.split()]
                if not coords:
                    return None
                xs = [c[0] for c in coords]
                ys = [c[1] for c in coords]
                return (sum(xs) / len(xs), sum(ys) / len(ys))

            for gm in re.finditer(
                r'<g id="([0-9a-f]+)" class="note"([^>]*)>(.*?)</g>', svg_text, re.S
            ):
                gid, attrs, inner = gm.groups()
                pm = re.search(r'<polygon[^>]*points="([^"]+)"', inner)
                dr = re.search(r'data-room="([0-9a-f]+)"', attrs or "")
                if pm:
                    c = centroid(pm.group(1))
                    if c:
                        geom["notes"][gid] = {
                            "data_room": dr.group(1) if dr else None,
                            "centroid": c,
                        }
            for gm in re.finditer(
                r'<g id="([0-9a-f]+)" class="roomShape"[^>]*>\s*<polygon points="([^"]+)"',
                svg_text,
            ):
                c = centroid(gm.group(2))
                if c:
                    poly = []
                    for p in gm.group(2).split():
                        xs, ys = p.split(",")
                        poly.append((float(xs), float(ys)))
                    geom["roomshapes"][gm.group(1)] = {"centroid": c, "polygon": poly}

            # подписи заметок (раунд 20): внутри <g class="note"
            # data-room="rid"> лежат <text>Имя</text><text>18'11" x 9'4"</text>
            # — ИМЯ КОМНАТЫ, которое Zillow рисует на плане. Регэксп до
            # первого </g> не годится (внутри вложенные <g>), режем по
            # границам следующих заметок
            spans = [(m.start(), m.group(0)) for m in re.finditer(r'<g[^>]*class="note"[^>]*>', svg_text)]
            for i, (pos, tagm) in enumerate(spans):
                drm = re.search(r'data-room="([0-9a-f]+)"', tagm)
                if not drm:
                    continue
                end = spans[i + 1][0] if i + 1 < len(spans) else len(svg_text)
                seg = svg_text[pos:end]
                txts = [re.sub(r"<[^>]+>", "", t) for t in re.findall(r"<text[^>]*>(.*?)</text>", seg, re.S)]
                txts = [t.strip() for t in txts if t and t.strip()]
                if txts:
                    for ent, ch in (("&#x27;", "'"), ("&#39;", "'"), ("&quot;", '"'),
                                    ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">")):
                        txts = [t.replace(ent, ch) for t in txts]
                    geom["notetexts"][drm.group(1)] = txts[0]
        except Exception:
            return geom
        return geom

    def _room_center_meters_from_geometry(self, geom, room_id):
        """Центр комнаты floorMapRoomId в ОТРИСОВАННЫХ метрах SVG (ось Y
        уже флипнута, см. докстринг _parse_floorplan_svg_geometry).
        Приоритет: прямоугольник площади комнаты (note.dimensionsArea —
        компактный прямоугольник самой комнаты) → полигон roomShape через
        note.data_room → roomShape с тем же id. None — если комнаты в SVG
        нет."""
        if not geom or not room_id:
            return None
        note = (geom.get("notes") or {}).get(room_id)
        if note and note.get("centroid"):
            cx, cy = note["centroid"]
            return (cx, -cy)
        rs = geom.get("roomshapes") or {}
        if note and note.get("data_room") and rs.get(note["data_room"]):
            cx, cy = rs[note["data_room"]]["centroid"]
            return (cx, -cy)
        if rs.get(room_id):
            cx, cy = rs[room_id]["centroid"]
            return (cx, -cy)
        return None

    def _extract_imx_pano_positions(self, imx_obj, pano_ids):
        """Ищет в разобранном JSON'е модели (vrmodels/imx_<rev>.json — его
        структура не задокументирована) координаты каждой панорамы.
        Стратегия генерическая: обходим дерево и для каждого dict'а
        (а) совпадает ли одно из полей id/entityId/panoId/uuid/key/guid с
        entityId панорамы, (б) не лежит ли dict ПОД КЛЮЧОМ-entityId;
        координаты берём из полей position/translation/center/location/
        loc/pos/point (вложенный dict с x/y, либо массив из 2-4 чисел),
        либо из прямых числовых полей x/y. Возвращает {panoId: (x, y)} в
        «сырных» мировых координатах — перевод в метры SVG (какие единицы
        у модели, мы не знаем) делает _apply_showcase_floor_plan_positions
        через data-scale/offset из <g id="meta"> с автопроверкой «сколько
        точек попало в границы плана»."""
        if not isinstance(imx_obj, (dict, list)) or not pano_ids:
            return {}
        ids = {p for p in pano_ids if p}
        found = {}
        ID_KEYS = ("id", "entityId", "entityid", "panoId", "panoid", "uuid", "key", "guid")
        POS_KEYS = ("position", "translation", "center", "location", "loc", "pos", "point")

        def is_num(v):
            return isinstance(v, (int, float)) and not isinstance(v, bool)

        def xy_from(d):
            if not isinstance(d, dict):
                return None
            for pk in POS_KEYS:
                pv = d.get(pk)
                if isinstance(pv, dict):
                    r = xy_from(pv)
                    if r:
                        return r
                if isinstance(pv, (list, tuple)) and len(pv) >= 2 and is_num(pv[0]) and is_num(pv[1]):
                    return (float(pv[0]), float(pv[1]))
            if is_num(d.get("x")) and is_num(d.get("y")):
                return (float(d["x"]), float(d["y"]))
            for pk in POS_KEYS:
                pv = d.get(pk)
                if isinstance(pv, (list, tuple)) and len(pv) >= 2 and is_num(pv[0]) and is_num(pv[1]):
                    return (float(pv[0]), float(pv[1]))
            return None

        def walk(o, depth=0):
            if depth > 16 or len(found) >= len(ids):
                return
            if isinstance(o, dict):
                # (а) у самого dict'а поле id/entityId/... равно entityId
                keyhit = None
                for ik in ID_KEYS:
                    iv = o.get(ik)
                    if isinstance(iv, str) and iv in ids:
                        keyhit = iv
                        break
                if keyhit:
                    r = xy_from(o)
                    if r:
                        found.setdefault(keyhit, r)
                # (б) dict лежит ПОД КЛЮЧОМ-entityId
                for k, v in o.items():
                    if isinstance(k, str) and k in ids and isinstance(v, dict):
                        r = xy_from(v)
                        if r:
                            found.setdefault(k, r)
                    if isinstance(v, dict):
                        walk(v, depth + 1)
                    elif isinstance(v, list):
                        walk(v, depth + 1)
            elif isinstance(o, list):
                for v in o:
                    walk(v, depth + 1)

        walk(imx_obj)
        return found

    def _distance_to_polygon_edges(self, x, y, poly):
        """Минимальное расстояние от точки до рёбер полигона (None — пустой)."""
        if not poly:
            return None
        dmin = None
        for k in range(len(poly)):
            axp, ayp = poly[k]
            bxp, byp = poly[(k + 1) % len(poly)]
            dx, dy = bxp - axp, byp - ayp
            l2 = dx * dx + dy * dy
            t = 0.0 if l2 == 0 else ((x - axp) * dx + (y - ayp) * dy) / l2
            t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            ex, ey = axp + t * dx, ayp + t * dy
            d = (x - ex) ** 2 + (y - ey) ** 2
            dmin = d if dmin is None else min(dmin, d)
        return None if dmin is None else math.sqrt(dmin)

    def _polygon_anchor(self, poly):
        """Гарантированно ВНУТРЕННЯЯ точка полигона («якорь»): сетка 26x26 по
        bbox, среди точек внутри полигона берём максимально удалённую от
        рёбер (приближение pole of inaccessibility). Нужен потому, что
        центроид невыпуклого полигона (L-образный коридор) может лежать
        СНАРУЖИ, и прижим «к центроиду» тогда не срабатывает. None — если
        полигон вырожден."""
        if not poly or len(poly) < 3:
            return None
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        if x1 <= x0 or y1 <= y0:
            return None
        best = None
        N = 26
        for i in range(1, N):
            for j in range(1, N):
                gx = x0 + (x1 - x0) * i / N
                gy = y0 + (y1 - y0) * j / N
                if not self._point_in_polygon(gx, gy, poly):
                    continue
                # расстояние до ближайшего ребра
                dmin = None
                for k in range(len(poly)):
                    axp, ayp = poly[k]
                    bxp, byp = poly[(k + 1) % len(poly)]
                    dx, dy = bxp - axp, byp - ayp
                    l2 = dx * dx + dy * dy
                    t = 0.0 if l2 == 0 else ((gx - axp) * dx + (gy - ayp) * dy) / l2
                    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                    ex, ey = axp + t * dx, ayp + t * dy
                    d = (gx - ex) ** 2 + (gy - ey) ** 2
                    dmin = d if dmin is None else min(dmin, d)
                if dmin is not None and (best is None or dmin > best[0]):
                    best = (dmin, (gx, gy))
        return best[1] if best else None

    def _wall_bbox_px(self, png_path):
        """Раунд 51: bbox стен плана (rgb~(34,72,146)) в пикселях PNG.
        Берутся связные куски стен на сетке 4px, и в bbox идут только куски
        не меньше 8% крупнейшего — мелкие синие линии (миниатюры этажей в
        сайдбаре Zillow, иконки) в рамку плана больше не попадают.
        Возвращает (x0, y0, x1, y1) или None."""
        try:
            from PIL import Image
            im = Image.open(png_path).convert("RGBA")
        except Exception:
            return None
        W, H = im.size
        px = im.load()
        S = 4
        gw, gh = W // S + 1, H // S + 1
        grid = bytearray(gw * gh)
        try:
            import numpy as _np  # раунд 53: векторная маска стен
            _a = _np.asarray(im, dtype=_np.int32)[::S, ::S]
            _m = ((_a[:, :, 3] > 128) & (((_a[:, :, 0] - 34) ** 2 + (_a[:, :, 1] - 72) ** 2
                                          + (_a[:, :, 2] - 146) ** 2) <= 45 ** 2))
            _g = _np.zeros((gh, gw), dtype=_np.uint8)
            _g[:_m.shape[0], :_m.shape[1]] = _m
            grid = bytearray(_g.tobytes())
        except Exception:
            for yy in range(0, H, S):
                for xx in range(0, W, S):
                    r, g, b, a = px[xx, yy]
                    if a > 128 and (r - 34) ** 2 + (g - 72) ** 2 + (b - 146) ** 2 <= 45 ** 2:
                        grid[(yy // S) * gw + xx // S] = 1
        seen = bytearray(gw * gh)
        comps = []
        for i0 in range(gw * gh):
            if not grid[i0] or seen[i0]:
                continue
            seen[i0] = 1
            st = [i0]
            n = 0
            x0 = y0 = 10 ** 9
            x1 = y1 = -1
            while st:
                i = st.pop()
                n += 1
                cx, cy = i % gw, i // gw
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for dx in (-2, -1, 0, 1, 2):
                    for dy in (-2, -1, 0, 1, 2):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < gw and 0 <= ny < gh:
                            j = ny * gw + nx
                            if grid[j] and not seen[j]:
                                seen[j] = 1
                                st.append(j)
            comps.append((n, x0, y0, x1, y1))
        if not comps:
            return None
        big = max(c[0] for c in comps)
        keep = [c for c in comps if c[0] >= 0.08 * big]
        bx0 = min(c[1] for c in keep) * S
        by0 = min(c[2] for c in keep) * S
        bx1 = max(c[3] for c in keep) * S + S - 1
        by1 = max(c[4] for c in keep) * S + S - 1
        if bx1 - bx0 < 50 or by1 - by0 < 50:
            return None
        return (bx0, by0, min(bx1, W - 1), min(by1, H - 1))

    def _detect_blue_dots_pil(self, png_path, area=None):
        """Раунд 22/51: находит СИНИЕ точки-камеры Zillow на скриншоте плана.
        Цвет точки rgb(43,108,246), кружок с белым ободком. Раунд 51 (лог
        15.30: на F2 найдено 22 «точки» при 10 настоящих): ложные срабатывания
        давали буквы синей вкладки «Floor Plan» (y≈55) и трек тумблера
        «3D Home» (нарезался делением по площади на 8 «точек»). Теперь:
        (1) форм-фактор проверяется у СКЛЕЕННОЙ группы, а не у осколков;
        (2) заполненность bbox как у круга; (3) белый/светлый ободок вокруг;
        (4) если передан area=(x0,y0,x1,y1) — только внутри рамки плана.
        Возвращает [(cx, cy), ...]."""
        try:
            from PIL import Image
        except ImportError:
            self.log_msg("[план][эталон] не установлен Pillow (pip install Pillow) — "
                         "точки со скриншота-эталона недоступны")
            return []
        try:
            im = Image.open(png_path).convert("RGB")
        except Exception:
            return []
        W, H = im.size
        px = im.load()
        TR, TG, TB = 43, 108, 246
        LIM = 70 ** 2

        # раунд 53: маска цвета одним векторным проходом numpy (в 30-60 раз
        # быстрее попиксельного PIL); без numpy — прежний путь
        _mask = None
        try:
            import numpy as _np
            _a = _np.asarray(im, dtype=_np.int32)
            _mask = (((_a[:, :, 0] - TR) ** 2 + (_a[:, :, 1] - TG) ** 2
                      + (_a[:, :, 2] - TB) ** 2) <= LIM)
            if area:
                _keep = _np.zeros_like(_mask)
                _keep[max(0, int(area[1]) - 40):int(area[3]) + 41,
                      max(0, int(area[0]) - 40):int(area[2]) + 41] = True
                _mask &= _keep
            _seeds = [(int(x) * 2, int(y) * 2) for y, x in _np.argwhere(_mask[::2, ::2])]
        except Exception:
            _mask = None

        if _mask is not None:
            def is_blue(x, y):
                return bool(_mask[y, x])
        else:
            def is_blue(x, y):
                r, g, b = px[x, y]
                return (r - TR) ** 2 + (g - TG) ** 2 + (b - TB) ** 2 <= LIM
            _seeds = ((xx, yy) for yy in range(0, H, 2) for xx in range(0, W, 2))

        seen = bytearray(W * H)
        comps = []
        for xx, yy in _seeds:
                if seen[yy * W + xx] or not is_blue(xx, yy):
                    continue
                stack = [(xx, yy)]
                seen[yy * W + xx] = 1
                pts = []
                while stack:
                    cx_, cy_ = stack.pop()
                    pts.append((cx_, cy_))
                    for nx_, ny_ in ((cx_ + 1, cy_), (cx_ - 1, cy_), (cx_, cy_ + 1), (cx_, cy_ - 1)):
                        if 0 <= nx_ < W and 0 <= ny_ < H and not seen[ny_ * W + nx_] and is_blue(nx_, ny_):
                            seen[ny_ * W + nx_] = 1
                            stack.append((nx_, ny_))
                if len(pts) >= 6:
                    comps.append(pts)
        # склейка осколков (точку разрывают буквы подписи) в радиусе 24 px
        cents = [(sum(p[0] for p in c) / len(c), sum(p[1] for p in c) / len(c)) for c in comps]
        used = [False] * len(comps)
        groups = []
        for i in range(len(comps)):
            if used[i]:
                continue
            used[i] = True
            grp = list(comps[i])
            gx, gy = cents[i]
            for j in range(i + 1, len(comps)):
                if not used[j] and abs(cents[j][0] - gx) < 24 and abs(cents[j][1] - gy) < 24:
                    used[j] = True
                    grp.extend(comps[j])
            groups.append(grp)
        cand = []
        for pts in groups:
            n = len(pts)
            bx0 = min(p[0] for p in pts); bx1 = max(p[0] for p in pts)
            by0 = min(p[1] for p in pts); by1 = max(p[1] for p in pts)
            bw, bh = bx1 - bx0 + 1, by1 - by0 + 1
            asp = max(bw, bh) / float(max(1, min(bw, bh)))
            fill = n / float(bw * bh)
            if n < 25 or asp > 2.3 or fill < 0.42 or max(bw, bh) > 90:
                continue
            cx = sum(p[0] for p in pts) / float(n)
            cy = sum(p[1] for p in pts) / float(n)
            if area and not (area[0] - 8 <= cx <= area[2] + 8 and area[1] - 8 <= cy <= area[3] + 8):
                continue
            # светлый ободок: точка Zillow — синий кружок в белой обводке
            rad = min(bw, bh) / 2.0
            rr = rad + max(2.0, 0.22 * rad)
            light = tot = 0
            for k in range(16):
                a = 2 * math.pi * k / 16
                sx_, sy_ = int(round(cx + rr * math.cos(a))), int(round(cy + rr * math.sin(a)))
                if 0 <= sx_ < W and 0 <= sy_ < H:
                    tot += 1
                    r, g, b = px[sx_, sy_]
                    if min(r, g, b) >= 185 or is_blue(sx_, sy_):
                        light += 1
            if tot < 12 or light < 0.6 * tot:
                continue
            cand.append((pts, n, asp, bw, bh, cx, cy))
        if not cand:
            return []
        # деление слипшихся (две камеры рядом) по площади — только для
        # вытянутых групп; эталон площади — медиана круглых групп
        rounds = sorted(c[1] for c in cand if c[2] <= 1.35) or sorted(c[1] for c in cand)
        med = rounds[len(rounds) // 2]
        dots = []
        for pts, n, asp, bw, bh, cx, cy in cand:
            if n < 0.35 * med:
                continue
            k = min(3, max(1, int(round(n / float(med))))) if asp > 1.35 else 1
            if k == 1:
                dots.append((cx, cy))
                continue
            key = (lambda p: p[0]) if bw >= bh else (lambda p: p[1])
            pts = sorted(pts, key=key)
            for c in range(k):
                chunk = pts[c * n // k:(c + 1) * n // k]
                if chunk:
                    dots.append((sum(p[0] for p in chunk) / float(len(chunk)),
                                 sum(p[1] for p in chunk) / float(len(chunk))))
        dots.sort(key=lambda d: (round(d[1]), round(d[0])))
        return dots

    def _align_png_to_geometry(self, png_path, geom, plan_png=None, plan_wh=None):
        """Раунд 22/51: совмещение скриншота плана Zillow с метрами SVG.
        Раунд 51 (основной путь): рамка стен скриншота ↔ рамка стен НАШЕГО
        растра того же SVG (plan_floor_*.png) — это один и тот же чертёж, так
        что соответствие точное (проверено на 5151 W Redondo: масштаб по X и
        Y совпадает до 0.4%), а пиксели растра переводятся в метры по
        viewBox. Прежний путь (рамка стен ↔ рамка полигонов комнат) давал
        сдвиг до 2.3 м из-за толщины стен — остаётся запасным.
        Возвращает функцию (px, py) -> (x_m, y_m) или None."""
        vb = (geom or {}).get("viewbox")
        if plan_png and vb and os.path.exists(plan_png):
            try:
                rb = self._cached_wall_bbox(png_path)
                pb = self._cached_wall_bbox(plan_png)
                if plan_wh:
                    pw, ph = plan_wh
                else:
                    from PIL import Image
                    with Image.open(plan_png) as _im:
                        pw, ph = _im.size
                if rb and pb and pw and ph:
                    ksx = (pb[2] - pb[0]) / float(rb[2] - rb[0])
                    ksy = (pb[3] - pb[1]) / float(rb[3] - rb[1])
                    if 0.93 <= ksx / ksy <= 1.07:
                        vbX, vbY, vbW, vbH = vb

                        def to_meters_plan(p, q):
                            X = pb[0] + (p - rb[0]) * ksx
                            Y = pb[1] + (q - rb[1]) * ksy
                            return (vbX + X / float(pw) * vbW, vbY + Y / float(ph) * vbH)

                        self._last_align_mode = "стены↔стены растра (%.3f/%.3f)" % (ksx, ksy)
                        return to_meters_plan
                    self._last_align_mode = None
                    self.log_msg("[план][совмещение] рамки стен скриншота и растра не "
                                 "подобны (%.3f vs %.3f) — запасной путь по комнатам" % (ksx, ksy))
            except Exception as e:
                self.log_msg(f"[план][совмещение] ошибка точного совмещения: {e} — запасной путь")
        self._last_align_mode = "стены↔полигоны комнат (запасной)"
        try:
            from PIL import Image
        except ImportError:
            return None
        try:
            im = Image.open(png_path).convert("RGB")
        except Exception:
            return None
        W, H = im.size
        px = im.load()
        col_cnt = {}
        row_cnt = {}
        for yy in range(0, H, 2):
            for xx in range(0, W, 2):
                r, g, b = px[xx, yy]
                if (r - 32) ** 2 + (g - 64) ** 2 + (b - 144) ** 2 <= 60 ** 2:
                    col_cnt[xx] = col_cnt.get(xx, 0) + 1
                    row_cnt[yy] = row_cnt.get(yy, 0) + 1
        if not col_cnt:
            return None
        cols = [x for x, c in col_cnt.items() if c >= 2]
        rows = [y for y, c in row_cnt.items() if c >= 2]
        if len(cols) < 10 or len(rows) < 10:
            cols = list(col_cnt)
            rows = list(row_cnt)
        wx0, wx1 = min(cols), max(cols)
        wy0, wy1 = min(rows), max(rows)
        rbb = self._wall_bbox_px(png_path)
        if rbb:
            wx0, wy0, wx1, wy1 = rbb
        if wx1 - wx0 < 50 or wy1 - wy0 < 50:
            return None
        xs, ys = [], []
        for rs in (geom.get("roomshapes") or {}).values():
            for (x, y) in (rs.get("polygon") or []):
                xs.append(x)
                ys.append(-y)
        if not xs:
            return None
        rx0, rx1, ry0, ry1 = min(xs), max(xs), min(ys), max(ys)
        sx = (rx1 - rx0) / (wx1 - wx0)
        sy = (ry1 - ry0) / (wy1 - wy0)

        def to_meters(p, q):
            return (rx0 + (p - wx0) * sx, ry0 + (q - wy0) * sy)

        return to_meters

    def _place_panos_by_dot_graph(self, floor_panos, meters, src_of, room_of_pano,
                                  geom, dots_m, floor_name, fid, links_by_id):
        """Раунд 51: расстановка панорам этажа по точкам Zillow через граф
        переходов (_solve_zillow_dot_assignment). Сматченные — ровно в свою
        точку (src «zdot_graph»), лишние — hidden_on_plan в центре своей
        комнаты (лестницы — в комнате лестниц). True — применено; False —
        не взялся (мало точек / ошибка), тогда работает прежний путь."""
        ids = [p.get("entityId") for p in floor_panos
               if p.get("entityId") and links_by_id.get(p.get("entityId")) is not None]
        if not ids or not dots_m:
            return False
        if getattr(self, "_imx_trusted_floor", None) == fid:
            # раунд 52: позиции из модели точные — точки Zillow только сверка
            vis = [pid for pid in ids if src_of.get(pid) == "imx"
                   and not links_by_id[pid].get("hidden_on_plan") and pid in meters]
            ds = sorted(min(math.hypot(meters[pid][0] - dx, meters[pid][1] - dy)
                            for dx, dy in dots_m) for pid in vis) if vis else []
            if ds:
                med, mx = ds[len(ds) // 2], ds[-1]
                self.log_msg(
                    "[план][сверка] этаж «%s»: модель imx ↔ точки Zillow: видимых %d, точек %d, "
                    "расхождение медиана %.2f м, макс %.2f м%s" % (
                        floor_name, len(vis), len(dots_m), med, mx,
                        "" if med <= 0.6 else " — ВНИМАНИЕ: модель не совпадает с планом Zillow"))
            return True

        def _is_stair(t):
            t = str(t or "").lower()
            return "stair" in t and "landing" not in t

        titles = {p.get("entityId"): (p.get("room") or p.get("title") or "") for p in floor_panos}
        non_stair = sum(1 for pid in ids if not _is_stair(titles.get(pid)))
        if len(dots_m) < max(1, 0.5 * non_stair):
            self.log_msg(
                "[план][граф] этаж «%s»: точек Zillow %d при %d жилых панорамах — "
                "похоже, режим «3D Home» выключен или скриншот неполный; "
                "граф не запускаю, прежняя раскладка" % (floor_name, len(dots_m), non_stair))
            return False
        polys = []
        for rid, rs in (geom.get("roomshapes") or {}).items():
            raw = rs.get("polygon")
            if raw and len(raw) >= 3:
                polys.append((rid, [(x, -y) for (x, y) in raw]))

        def _area(poly):
            return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1]
                           - poly[(i + 1) % len(poly)][0] * poly[i][1]
                           for i in range(len(poly)))) / 2.0

        dot_rid = []
        for (dx, dy) in dots_m:
            best = None
            for rid, poly in polys:
                if self._point_in_polygon(dx, dy, poly):
                    a = _area(poly)
                    if best is None or a < best[0]:
                        best = (a, rid)
            dot_rid.append(best[1] if best else None)
        nts = geom.get("notetexts") or {}
        dot_label = [nts.get(r) if r else None for r in dot_rid]
        rooms_of_note = {}
        for nid, nt in (geom.get("notes") or {}).items():
            rooms_of_note.setdefault(nid, set()).add(nid)
            if nt.get("data_room"):
                rooms_of_note[nid].add(nt["data_room"])
        poly_by_rid = {}
        for rid, poly in polys:
            poly_by_rid.setdefault(rid, []).append(poly)
        stair_polys = [poly for rid, poly in polys if "stair" in str(nts.get(rid) or "").lower()]

        def _dist_to(polys_, x, y):
            best = None
            for poly in polys_:
                if self._point_in_polygon(x, y, poly):
                    return 0.0
                d = self._distance_to_polygon_edges(x, y, poly)
                if d is not None and (best is None or d < best):
                    best = d
            return best

        def room_cost(pid, di):
            x, y = dots_m[di]
            c = 0.0
            note = room_of_pano.get(pid)
            if note:
                ok = rooms_of_note.get(note, {note})
                if dot_rid[di] not in ok:
                    d = _dist_to([pp for r in ok for pp in poly_by_rid.get(r, [])], x, y)
                    c += 80.0 if d is None or d > 0.5 else 20.0
            elif "stair" in str(titles.get(pid) or "").lower() and stair_polys:
                d = _dist_to(stair_polys, x, y) or 0.0
                c += min(8.0, 8.0 * d / 1.5)
            if src_of.get(pid) == "imx" and pid in meters:
                d = math.hypot(meters[pid][0] - x, meters[pid][1] - y)
                c += min(d, 3.0) * 10.0
            return c

        pano_list = []
        for p in floor_panos:
            pid = p.get("entityId")
            if pid not in ids:
                continue
            pano_list.append((pid, titles.get(pid),
                              [(d.get("destEntityId"), float(d.get("departureAngle") or 0.0))
                               for d in (p.get("destinations") or []) if d.get("destEntityId")]))
        res = self._solve_zillow_dot_assignment(pano_list, dots_m, dot_label, room_cost, fid)
        if not res:
            return False

        def _num(pid):
            return (links_by_id.get(pid) or {}).get("n") or pid

        for pid, di in res["assign"].items():
            meters[pid] = tuple(dots_m[di])
            src_of[pid] = "zdot_graph"
            links_by_id[pid].pop("hidden_on_plan", None)
        for pid in res["hidden"]:
            links_by_id[pid]["hidden_on_plan"] = True
            rc = self._room_center_meters_from_geometry(geom, room_of_pano.get(pid))
            if not rc and _is_stair(titles.get(pid)) and stair_polys:
                rc = self._polygon_anchor(stair_polys[0])
            if rc:
                meters[pid] = rc
                src_of[pid] = "room_hidden"
        self.log_msg(
            "[план][граф] этаж «%s»: точек %d, на точках %d, скрытых %d %s, пустых точек %d; "
            "знак угла %+d, стоимость %.0f, совмещение: %s" % (
                floor_name, len(dots_m), len(res["assign"]), len(res["hidden"]),
                sorted(_num(p) for p in res["hidden"]), len(res["free_dots"]),
                res["sign"], res["cost"], getattr(self, "_last_align_mode", None) or "?"))
        self.log_msg("[план][граф] этаж «%s»: № → точка: %s" % (
            floor_name, ", ".join("%s→(%.2f,%.2f)" % (_num(p), dots_m[d][0], dots_m[d][1])
                                  for p, d in sorted(res["assign"].items(), key=lambda t: str(_num(t[0])).zfill(4)))))
        if res["uncertain"]:
            self.log_msg("[план][граф] этаж «%s»: неуверенно (мало связей для проверки "
                         "углом): %s" % (floor_name, sorted(_num(p) for p in res["uncertain"])))
        return True

    def _imx_pano_meta(self, imx_obj, floor_id):
        """Раунд 52: разбор vrmodels/imx_<rev>.json «как есть» (структура
        подтверждена 15.32, 5151 W Redondo): panos{id: center{x,y},
        locationConfidence, isOutdoor}, panoMinimumLocationConfidence,
        visualizations{..., floorId, scale{x,y}}. Главное:
        • scale.y < 0 у плана этажа ⇒ ось Y модели направлена ВВЕРХ, а в
          SVG — вниз: y_svg = −y_imx. Прежний выбор «уже метры, Y вниз»
          давал ЗЕРКАЛО плана по вертикали — это и было «перемешаны и не на
          своём месте» (сверено с точками Zillow: после флипа расхождение
          ≤ 0.2 м на всех 4 этажах);
        • locationConfidence < panoMinimumLocationConfidence (0.65) — позиция
          неизвестна (лестницы, центр (0,0) — заглушка), Zillow такие точки
          НЕ рисует; isOutdoor — тоже не рисует (патио/крыша).
        Возвращает {"panos": {pid: {"xy", "ok", "outdoor", "conf"}},
        "flip": True/False/None, "minconf": float} или None."""
        if not isinstance(imx_obj, dict) or not isinstance(imx_obj.get("panos"), dict):
            return None
        try:
            minconf = float(imx_obj.get("panoMinimumLocationConfidence"))
        except (TypeError, ValueError):
            minconf = 0.65
        out = {}
        for pid, p in imx_obj["panos"].items():
            if not isinstance(p, dict):
                continue
            c = p.get("center") or {}
            x, y = c.get("x"), c.get("y")
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                continue
            conf = p.get("locationConfidence")
            stub = (x == 0 and y == 0)
            ok = (not stub) and (not isinstance(conf, (int, float)) or conf >= minconf)
            out[pid] = {"xy": (float(x), float(y)), "ok": ok,
                        "outdoor": bool(p.get("isOutdoor")), "conf": conf}
        flip = None
        vis = imx_obj.get("visualizations")
        vid = ((imx_obj.get("floors") or {}).get(floor_id) or {}).get("visualizationId")
        cands = []
        if isinstance(vis, dict):
            if vid and isinstance(vis.get(vid), dict):
                cands.append(vis[vid])
            cands.extend(v for v in vis.values() if isinstance(v, dict) and v.get("floorId") == floor_id)
        for v in cands:
            sy = (v.get("scale") or {}).get("y")
            if isinstance(sy, (int, float)) and sy != 0:
                flip = sy < 0
                break
        return {"panos": out, "flip": flip, "minconf": minconf}

    def _imx_room_score(self, conv, geom, room_of_pano):
        """Раунд 52: сколько панорам с известной комнатой (floorMapRoomId)
        попадают в полигон СВОЕЙ комнаты при данном пересчёте (запасной выбор
        флипа, если у модели нет visualizations.scale)."""
        polys = {}
        for rid, rs in (geom.get("roomshapes") or {}).items():
            raw = rs.get("polygon")
            if raw and len(raw) >= 3:
                polys[rid] = [(x, -y) for (x, y) in raw]
        notes = geom.get("notes") or {}
        sc = 0
        for pid, (x, y) in conv.items():
            nid = room_of_pano.get(pid)
            if not nid:
                continue
            rids = {nid}
            if (notes.get(nid) or {}).get("data_room"):
                rids.add(notes[nid]["data_room"])
            if any(r in polys and self._point_in_polygon(x, y, polys[r]) for r in rids):
                sc += 1
        return sc

    def _solve_zillow_dot_assignment(self, pano_list, dots, dot_label, room_cost, seed_key):
        """Раунд 51: кто на какой точке Zillow. Без imx-модели (HTTP 403 в
        логе 15.30) единственная надёжная информация о взаимном положении
        камер — граф переходов: destinations[].departureAngle. Проверено на
        5151 W Redondo F4 (13 точек, ручная разметка): направление от точки
        A на точку B в экранных координатах (Y вниз, угол по часовой) минус
        departureAngle(A→B) даёт у каждой панорамы ПОСТОЯННЫЙ сдвиг (разброс
        3-10°) — поворот её собственной сферы. Значит, правильная раскладка —
        та, где у каждой панорамы эти сдвиги совпадают.

        Стоимость раскладки: разброс сдвигов (по панораме, >=2 видимых
        соседей) + длина переходов + комната панорамы (floorMapRoomId) +
        совпадение названия с подписью комнаты под точкой + цена «скрыть»
        (лестницы/улица — дёшево, жилые — дорого) + цена пустой точки.
        Поиск — отжиг с фиксированным зерном (детерминированно), обе
        конвенции знака угла, берётся лучшая.

        pano_list: [(pid, title, [(dest_pid, departureAngle), ...]), ...]
        dots: [(x, y), ...] — Y вниз; dot_label: подпись комнаты под точкой;
        room_cost(pid, di) -> штраф за комнату (0, если комната не известна).
        Возвращает {"assign": {pid: di}, "hidden": [pid], "cost": float,
        "sign": ±1, "uncertain": [pid], "free_dots": [di]}."""
        import random as _rnd
        import zlib as _zlib
        m, n = len(pano_list), len(dots)
        if not m or not n:
            return None
        pids = [p[0] for p in pano_list]
        pos = {pid: i for i, pid in enumerate(pids)}
        nb = [[(pos[d], a) for d, a in p[2] if d in pos and d != p[0]] for p in pano_list]
        rev = [set() for _ in range(m)]
        for i in range(m):
            for j, _a in nb[i]:
                rev[j].add(i)

        def _rk(s):
            t = re.sub(r"\([^)]*\)", " ", str(s or "").lower())
            t = re.sub(r"[^a-zа-яё0-9 ]+", " ", t)
            return re.sub(r"\s+", " ", t).strip()

        OUT = ("rooftop", "deck", "patio", "balcon", "yard", "garage", "street",
               "exterior", "outdoor", "front", "backyard", "porch", "terrace", "roof")
        titles = [_rk(p[1]) for p in pano_list]
        hid_cost = []
        for t in titles:
            if "stair" in t and "landing" not in t:
                hid_cost.append(0.0)
            elif any(w in t for w in OUT):
                hid_cost.append(15.0)
            else:
                hid_cost.append(200.0)
        labs = [_rk(l) if l else "" for l in dot_label]
        prior = [[0.0] * n for _ in range(m)]
        for i in range(m):
            for di in range(n):
                lab, t = labs[di], titles[i]
                if not lab:
                    c = 8.0
                elif lab == t or (len(lab) >= 5 and len(t) >= 5 and (lab.startswith(t) or t.startswith(lab))):
                    c = 0.0
                elif "stair" in lab and "stair" in t:
                    c = 5.0
                else:
                    c = 25.0
                try:
                    c += float(room_cost(pids[i], di) or 0.0)
                except Exception:
                    pass
                prior[i][di] = c
        xs = [d[0] for d in dots]
        ys = [d[1] for d in dots]
        scale = max(max(xs) - min(xs), max(ys) - min(ys)) or 1.0
        FREE = 40.0

        def run(sign, seed):
            rng = _rnd.Random(seed)

            def node(i, a):
                di = a[i]
                if di is None:
                    return hid_cost[i]
                x, y = dots[di]
                c = prior[i][di]
                res = []
                for j, dep in nb[i]:
                    dj = a[j]
                    if dj is None:
                        continue
                    x2, y2 = dots[dj]
                    c += 30.0 * math.hypot(x2 - x, y2 - y) / scale
                    if dj != di:
                        res.append(math.atan2(y2 - y, x2 - x) - math.radians(sign * dep))
                if len(res) >= 2:
                    mu = math.atan2(sum(math.sin(r) for r in res), sum(math.cos(r) for r in res))
                    for r in res:
                        dd = abs(math.degrees((r - mu + math.pi) % (2 * math.pi) - math.pi))
                        c += min(dd, 60.0) ** 2 / 25.0
                return c

            def total(a):
                used = sum(1 for v in a if v is not None)
                return sum(node(i, a) for i in range(m)) + FREE * (n - used)

            best = None
            for _r in range(6):
                a = list(range(n))[:m] + [None] * max(0, m - n)
                rng.shuffle(a)
                cur = total(a)
                bl = (cur, a[:])
                T = 60.0
                for _it in range(12000):
                    i = rng.randrange(m)
                    if rng.random() < 0.6:
                        j = rng.randrange(m)
                        if j == i or a[i] == a[j]:
                            continue
                        aff = {i, j} | rev[i] | rev[j]
                        before = sum(node(k, a) for k in aff)
                        a[i], a[j] = a[j], a[i]
                        dlt = sum(node(k, a) for k in aff) - before
                        if dlt <= 0 or rng.random() < math.exp(-dlt / T):
                            cur += dlt
                        else:
                            a[i], a[j] = a[j], a[i]
                    else:
                        taken = set(v for v in a if v is not None)
                        opts = [d for d in range(n) if d not in taken] + [None]
                        v = opts[rng.randrange(len(opts))]
                        if v == a[i]:
                            continue
                        aff = {i} | rev[i]
                        old = a[i]
                        before = sum(node(k, a) for k in aff)
                        a[i] = v
                        dfree = FREE * ((1 if old is not None else 0) - (1 if v is not None else 0))
                        dlt = sum(node(k, a) for k in aff) - before + dfree
                        if dlt <= 0 or rng.random() < math.exp(-dlt / T):
                            cur += dlt
                        else:
                            a[i] = old
                    if cur < bl[0] - 1e-9:
                        bl = (cur, a[:])
                    T = max(0.05, T * 0.9993)
                if best is None or bl[0] < best[0]:
                    best = bl
            return best

        seed0 = _zlib.crc32(str(seed_key).encode("utf-8")) & 0xFFFFFFFF
        cands = [(run(s, seed0 + (1 if s > 0 else 2)), s) for s in (1, -1)]
        (cost, a), sign = min(cands, key=lambda t: t[0][0])
        assign = {pids[i]: a[i] for i in range(m) if a[i] is not None}
        hidden = [pids[i] for i in range(m) if a[i] is None]
        uncertain = []
        for i in range(m):
            if a[i] is None:
                continue
            k = sum(1 for j, _d in nb[i] if a[j] is not None and a[j] != a[i])
            if k < 2 and prior[i][a[i]] > 0:
                uncertain.append(pids[i])
        free = [d for d in range(n) if d not in set(assign.values())]
        return {"assign": assign, "hidden": hidden, "cost": cost, "sign": sign,
                "uncertain": uncertain, "free_dots": free}

    def _apply_zillow_dot_positions(self, floor_panos, meters, src_of,
                                    room_of_pano, geom, dots_m, floor_name,
                                    p_title):
        """Раунд 22: ставит панорамы на ТОЧКИ-КАМЕРЫ, снятые с родного
        плана Zillow (скриншот с синими точками). Совместимость «точка ↔
        панорама»: точка лежит в комнате (самый маленький содержащий
        полигон), панорама этой комнаты (room_of_pano) ИЛИ имя панорамы
        совпадает с подписью комнаты (лестницы). Фаза 1 — жадный 1:1
        глобально по возрастанию расстояния; фаза 2 — оставшиеся
        кандидаты комнаты подтягиваются к ближайшей точке их комнаты
        спиралью (0.55 м, детерминированно, со пристёгиванием к
        полигону). imx-панорамы не трогает. Возвращает число
        переставленных."""
        if not dots_m:
            return 0
        polys = []
        for rid, rs in (geom.get("roomshapes") or {}).items():
            raw = rs.get("polygon")
            if raw and len(raw) >= 3:
                polys.append((rid, [(x, -y) for (x, y) in raw]))
        if not polys:
            return 0
        nts = geom.get("notetexts") or {}
        note_by_dataroom = {}
        for nid, nt in (geom.get("notes") or {}).items():
            if nt.get("data_room"):
                note_by_dataroom.setdefault(nt["data_room"], []).append(nid)

        def rkey(s):
            t = re.sub(r"\([^)]*\)", " ", str(s or "").lower())
            t = re.sub(r"[^a-zа-я0-9 ]+", " ", t)
            return re.sub(r"\s+", " ", t).strip() or None

        # точка → самая конкретная (самая маленькая) содержащая комната
        dot_rid = []
        for (dx, dy) in dots_m:
            rid = None
            best_area = None
            for r2, poly in polys:
                if self._point_in_polygon(dx, dy, poly):
                    area = abs(sum(
                        poly[i][0] * poly[(i + 1) % len(poly)][1]
                        - poly[(i + 1) % len(poly)][0] * poly[i][1]
                        for i in range(len(poly))
                    ))
                    if best_area is None or area < best_area:
                        best_area = area
                        rid = r2
            dot_rid.append(rid)

        def compatible(pid, rid):
            if rid is None:
                return False
            room_notes = set(note_by_dataroom.get(rid, []))
            if room_of_pano.get(pid) and room_of_pano[pid] in room_notes:
                return True
            k_name = rkey(nts.get(rid))
            return bool(k_name) and rkey(p_title.get(pid)) == k_name

        _cand_all = [p.get("entityId") for p in floor_panos
                     if p.get("entityId") in meters]
        # раунд 46: imx-позиции обычно надёжны, но если выродились в кучу
        # (разброс < 1.5 м при >=3 точках — тот самый константный
        # floorplanMeters) — верить им нельзя, переставляем на точки Zillow
        _degenerate = False
        if len(_cand_all) >= 3:
            _xs = [meters[pid][0] for pid in _cand_all]
            _ys = [meters[pid][1] for pid in _cand_all]
            _degenerate = ((_max_x := max(_xs)) - min(_xs)) ** 2 + \
                          ((_max_y := max(_ys)) - min(_ys)) ** 2 < 1.5 ** 2
        if _degenerate:
            self.log_msg("[план][showcase] этаж «%s»: позиции выродились в кучу "
                         "(разброс < 1.5 м) — переставляю на точки Zillow ВСЕ "
                         "панорамы, включая imx (матч по комнатам)" % floor_name)
            cand = list(_cand_all)
        else:
            cand = [pid for pid in _cand_all if src_of.get(pid) != "imx"]
        dot_taken = [False] * len(dots_m)
        pano_dot = {}
        # фаза 1: жадный 1:1 по возрастанию расстояния
        pairs = []
        for di, (dx, dy) in enumerate(dots_m):
            for pid in cand:
                if compatible(pid, dot_rid[di]):
                    if _degenerate:
                        d = 0.0  # куча: расстояниям верить нельзя, порядок нейтральный
                    else:
                        d = (meters[pid][0] - dx) ** 2 + (meters[pid][1] - dy) ** 2
                    pairs.append((d, di, pid))
        pairs.sort(key=lambda t: (t[0], t[1], t[2]))
        for d, di, pid in pairs:
            if dot_taken[di] or pid in pano_dot:
                continue
            dot_taken[di] = True
            pano_dot[pid] = di
        # фаза 2: оставшиеся кандидаты → ближайшая точка их комнаты
        for pid in cand:
            if pid in pano_dot:
                continue
            best = None
            for di, (dx, dy) in enumerate(dots_m):
                if dot_taken[di] or not compatible(pid, dot_rid[di]):
                    continue
                if _degenerate:
                    d = 0.0  # куча: расстояниям верить нельзя
                else:
                    d = (meters[pid][0] - dx) ** 2 + (meters[pid][1] - dy) ** 2
                if best is None or d < best[0]:
                    best = (d, di)
            if best is not None:
                pano_dot[pid] = best[1]
                dot_taken[best[1]] = True
        # фаза 3 (раунд 40, замечание 3 «не соотносишь»): оставшиеся
        # кандидаты (центроиды/центр этажа) и незанятые точки — чистым
        # ближайшим расстоянием, без комнатной совместимости (5151 W
        # Redondo Floor 1: одна комната-«floor» без заметок -> фазы 1-2
        # не ставили НИЧЕГО, хотя точка = позиция камеры).
        _free = [di for di in range(len(dots_m)) if not dot_taken[di]]
        _left = [pid for pid in cand if pid not in pano_dot]
        while _free and _left:
            _best = None
            for pid in _left:
                for di in _free:
                    d = (meters[pid][0] - dots_m[di][0]) ** 2 + \
                        (meters[pid][1] - dots_m[di][1]) ** 2
                    if _best is None or d < _best[0]:
                        _best = (d, pid, di)
            if _best is None or _best[0] > 6.25:
                break  # раунд 45: дальше 2.5 м — чужая/ложная точка, не тянем
            _d, _pid, _di = _best
            pano_dot[_pid] = _di
            dot_taken[_di] = True
            _free.remove(_di)
            _left.remove(_pid)
        # раскладка: первая панорама точки — точно в точку, остальные —
        # спираль вокруг неё (внутри полигона комнаты)
        occ = {}
        placed = 0
        polys_by_rid = {r2: [(p, self._polygon_anchor(p)) for rr, p in polys if rr == r2]
                        for r2 in set(dot_rid) if r2}
        for pid in sorted(pano_dot, key=lambda q: (pano_dot[q], q)):
            di = pano_dot[pid]
            dx, dy = dots_m[di]
            k = occ.get(di, 0)
            occ[di] = k + 1
            pt = (dx, dy)
            if k:
                ang = k * 2.399963
                rad = 0.55 * math.sqrt(k)
                rp = polys_by_rid.get(dot_rid[di])
                pt = self._snap_point_into_polygons(
                    (dx + rad * math.cos(ang), dy + rad * math.sin(ang)), rp)
            meters[pid] = pt
            src_of[pid] = "zdot"
            placed += 1
        if placed:
            self.log_msg(
                f"[план][showcase] этаж «{floor_name}»: поставлено на точки Zillow "
                f"со скриншота-эталона: {placed} (точек найдено: {len(dots_m)})"
            )
        return placed

    def _snap_point_into_polygons(self, pt, polys):
        """Ближайшая к pt точка ВНУТРИ объединения полигонов (пола этажа).
        Если точка уже внутри хотя бы одного полигона — возвращается как есть.
        Иначе ищется ближайшая точка на рёбрах всех полигонов, чуть сдвинутая
        внутрь (к центроиду полигона), — «камера встаёт на край комнаты».
        Нужна, потому что viewBox плана шире контура дома: после
        расталкивания камеры выезжали за стены и висели на чёрном фоне
        рядом с планом (5151 W Redondo, скриншоты пользователя)."""
        if not polys:
            return pt
        x, y = pt
        for poly, _anchor in polys:
            if self._point_in_polygon(x, y, poly):
                # точка внутри, но почти на стене (глубина < 6 см): маркер
                # визуально садится НА линию стены и после округления координат
                # может «вылезти» наружу — углубляем к центроиду
                dmin = self._distance_to_polygon_edges(x, y, poly)
                if dmin is not None and dmin < 0.06:
                    pcx = sum(p[0] for p in poly) / len(poly)
                    pcy = sum(p[1] for p in poly) / len(poly)
                    nx, ny = x + (pcx - x) * 0.12, y + (pcy - y) * 0.12
                    if self._point_in_polygon(nx, ny, poly):
                        return (nx, ny)
                return (x, y)
        best = None
        for poly, anchor in polys:
            if not poly or len(poly) < 3:
                continue
            # кандидат-якорь: гарантированно внутри (пусть и не ближайший)
            if anchor is not None:
                d = (anchor[0] - x) ** 2 + (anchor[1] - y) ** 2
                if best is None or d < best[0]:
                    best = (d, (anchor[0], anchor[1]))
            cx = sum(p[0] for p in poly) / len(poly)
            cy = sum(p[1] for p in poly) / len(poly)
            n = len(poly)
            for i in range(n):
                x1, y1 = poly[i]
                x2, y2 = poly[(i + 1) % n]
                dx, dy = x2 - x1, y2 - y1
                l2 = dx * dx + dy * dy
                t = 0.0 if l2 == 0 else ((x - x1) * dx + (y - y1) * dy) / l2
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                px, py = x1 + t * dx, y1 + t * dy
                # ступенчато внутрь полигона (к центроиду), пока точка не
                # окажется строго внутри: 3% -> 8% -> 15% -> 30%. Гарантирует
                # «внутри» даже для точек в узких щелях между полигонами
                # шаги В МЕТРАХ (5/12/25/50 см к центроиду): мелкие
                # относительные сдвиги оставляли точку на волос от ребра.
                # Принимаем шаг ТОЛЬКО если кандидат не просто «внутри» по
                # ray-casting (точка ровно НА ребре даёт ложный True), а на
                # глубине >= 4.5 см от всех рёбер — тогда округления координат
                # никогда не выкинут камеру из помещения
                ix = iy = None
                dpc = math.hypot(cx - px, cy - py)
                if dpc > 1e-9:
                    for step in (0.05, 0.12, 0.25, 0.50):
                        frac = min(0.95, step / dpc)
                        tx, ty = px + (cx - px) * frac, py + (cy - py) * frac
                        if not self._point_in_polygon(tx, ty, poly):
                            continue
                        dm = self._distance_to_polygon_edges(tx, ty, poly)
                        if dm is not None and dm < 0.045:
                            continue
                        ix, iy = tx, ty
                        break
                if ix is not None:
                    d = (ix - x) ** 2 + (iy - y) ** 2
                    if best is None or d < best[0]:
                        best = (d, (ix, iy))
        return best[1] if best else (x, y)

    def _point_in_polygon(self, x, y, poly):
        inside = False
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
        return inside

    def _apply_showcase_floor_plan_positions(self, links, panos, rich_media, skip_floor_ids=None):
        """ГЛАВНЫЙ источник plan_px для формата "showcase" (richMedia из
        GraphQL: panos[] есть, panoLoc.world/visualizations НЕТ, растрового
        плана на карточке нет — зато в самом richMedia есть официальный
        SVG плана этажа (showcase.floors[].primarySvgSource, публичный CDN)
        и связь «панорама → комната» (allPanosToRooms / rooms[] — а id
        групп <g class="note"> в SVG это и есть floorMapRoomId, проверено
        18/18 на реальном объявлении 18765 Labrador St, zpid 20176199).

        На каждый этаж (floors[].primarySvgSource):
          1) скачиваем SVG (обычный https, без авторизации — проверено);
          2) вшиваем width/height по viewBox и растеризуем в PNG тем же
             Chrome (_rasterize_svg_to_png): план без letterbox, с
             прозрачным фоном, размер заранее известен;
          3) позиция каждой панорамы этажа:
             а) ТОЧНАЯ — из перехваченного vrmodels/imx_<rev>.json, если
                3D-просмотрщик успел его загрузить (см.
                _captured_imx_from_network); «сырые» координаты переводятся
                в метры через data-scale/offset из <g id="meta">, вариант
                пересчёта выбирается автопроверкой «>=60% точек внутри
                границ плана»;
             б) иначе ЦЕНТРОИД КОМНАТЫ панорамы (floorMapRoomId → note
                polygon; точность 0.3-1.0 м по реальному объявлению —
                камера встаёт в середину своей комнаты);
             в) панорамы без комнаты (коридоры/двор) — среднее координат
                соседей по графу переходов (destinations), до 4 проходов;
                если и это не помогло — plan_px остаётся пустым.
        Этажи из skip_floor_ids (официальные visualizations с
        bounds/scale) не трогаются. Источник НЕ зависит от DOM панели
        Floor Plan (раунд 15: панель ненадёжна — в живом прогоне
        16:07:18.671 не отрендерилась к моменту захвата).

        Возвращает сводку {"imx": N, "room": N, "interpolated": N, "none": N}."""
        if not rich_media or not isinstance(rich_media, dict):
            return None
        skip_floor_ids = skip_floor_ids or set()
        src_floors = {}
        for f in rich_media.get("floors") or []:
            fid = (f or {}).get("id")
            src = (f or {}).get("primarySvgSource")
            if fid and src and fid not in skip_floor_ids:
                src_floors[fid] = f
        if not src_floors:
            return None

        page = self._active_page or self._network_watch_page
        multi = len(src_floors) > 1

        # панорама → floorMapRoomId
        room_of_pano = {}
        apr = rich_media.get("allPanosToRooms")
        if isinstance(apr, dict):
            room_of_pano.update(apr)
        for r in rich_media.get("rooms") or []:
            rid = (r or {}).get("floorMapRoomId")
            pid = (r or {}).get("panoId")
            if rid and pid and pid not in room_of_pano:
                room_of_pano[pid] = rid

        neighbors = {}
        for p in panos:
            nb = [d.get("destEntityId") for d in (p.get("destinations") or []) if d.get("destEntityId")]
            neighbors[p.get("entityId")] = nb

        total_stats = {"imx": 0, "room": 0, "floor": 0, "interpolated": 0, "none": 0}
        for fid, f in src_floors.items():
            floor_name = f.get("name") or fid
            url = f.get("primarySvgSource")
            fname_svg = f"plan_floor_{safe_filename(fid)}.svg" if multi else "plan_floor.svg"
            fname_png = f"plan_floor_{safe_filename(fid)}.png" if multi else "plan.png"
            svg_path = os.path.join(ARCHIVE_DIR, fname_svg)
            png_path = os.path.join(ARCHIVE_DIR, fname_png)

            # этот же URL мог быть уже скачан с карточки (floor_shape/<id>/compressed.svg
            # попадается в разметке карточки) — не качаем дважды. Раунд 16:
            # имя файла ищем по ТОЧНОМУ URL (self._listing_floor_plan_file_by_url,
            # строится в _download_listing_floor_plans_from_urls) — раньше был
            # захардкожен plan_listing.svg, и второй этаж получал копию SVG
            # ПЕРВОГО этажа (в логе выглядело как «тот же URL»), из-за чего
            # не находил свои комнаты и оставался без координат.
            have_svg = os.path.exists(svg_path) and os.path.getsize(svg_path) > 1000
            if not have_svg:
                known_fname = (self._listing_floor_plan_file_by_url or {}).get(url.split("?")[0])
                if known_fname:
                    kname = os.path.join(ARCHIVE_DIR, known_fname)
                    if os.path.exists(kname) and os.path.getsize(kname) > 1000:
                        try:
                            shutil.copyfile(kname, svg_path)
                            have_svg = True
                            self.log_msg(
                                f"[план][showcase] этаж «{floor_name}»: переиспользую уже скачанный "
                                f"{known_fname} (тот же URL)"
                            )
                            # Раунд 36 (фикс прогона 2026-09-22 11:41): автоэталоны
                            # планов из план-вида 3D-тура. Маппинг «Floor N» ->
                            # floorId = src_floors (порядок = floors[] richMedia).
                            # Одна попытка на тур (ключ — URL + набор этажей);
                            # если ref_floor_<fid>.png уже лежат в arhive/ (их
                            # читает блок «б2» ниже) — не снимаем заново.
                            _fpk = (self._original_url, tuple(sorted(src_floors)))
                            if getattr(self, "_fplan_refs_key", None) != _fpk and not all(
                                    os.path.exists(os.path.join(
                                        ARCHIVE_DIR, f"ref_floor_{fid2}.png"))
                                    for fid2 in src_floors):
                                self._fplan_refs_key = _fpk
                                try:
                                    refs = self._capture_interactive_floorplan_panel(
                                        [((f2 or {}).get("name") or f"Floor {j + 1}", fid2)
                                         for j, (fid2, f2) in enumerate(src_floors.items())])
                                    self.log_msg(f"[план-интеракт] автосъёмка дала "
                                                 f"{len(refs)} эталонов")
                                except Exception as e:
                                    self.log_msg(f"[план-интеракт] вызов из showcase-блока "
                                                 f"не удался: {e}")
                        except Exception:
                            pass
            if not have_svg:
                task = DownloadTask(
                    url, svg_path, label=f"официальный план этажа «{floor_name}»",
                    meta={"fname": fname_svg},
                )
                run_download_batch([task], self._cookies_header,
                                   self._referer or self._original_url, self.log_msg)
                have_svg = task.success and os.path.exists(svg_path) and os.path.getsize(svg_path) > 1000
            if not have_svg:
                self.log_msg(f"[план][showcase] этаж «{floor_name}»: SVG плана не скачался — этаж пропущен")
                continue

            baked = self._bake_svg_width_height(svg_path)
            if not baked:
                continue
            w, h, vb = baked[0], baked[1], baked[2]
            png_file = None
            if page is not None and self._rasterize_svg_to_png(page, svg_path, png_path, size=w):
                if os.path.exists(png_path) and os.path.getsize(png_path) > 500:
                    png_file = fname_png
            if not png_file:
                self.log_msg(
                    f"[план][showcase] этаж «{floor_name}»: не удалось растеризовать SVG в PNG "
                    "(нет живой вкладки?) — этаж пропущен, SVG остался в архиве"
                )
                continue

            try:
                with open(svg_path, "r", encoding="utf-8") as fh:
                    geom = self._parse_floorplan_svg_geometry(fh.read())
            except Exception as e:
                self.log_msg(f"[план][showcase] этаж «{floor_name}»: не разобрал SVG: {e}")
                continue
            if not geom.get("viewbox"):
                geom["viewbox"] = vb
            vbX, vbY, vbW, vbH = geom["viewbox"]
            self.log_msg(
                f"[план][showcase] этаж «{floor_name}»: план {fname_png} {w}x{h}px, "
                f"viewBox=({vbX:.2f},{vbY:.2f},{vbW:.2f},{vbH:.2f}) м, комнат-заметок в SVG: "
                f"{len(geom.get('notes') or {})}, meta-калибровка: "
                f"{'есть' if geom.get('meta') else 'нет'}"
            )

            floor_panos = [p for p in panos if p.get("floorId") == fid]
            floor_ids = {p.get("entityId") for p in floor_panos}
            links_by_id = {l["id"]: l for l in links}

            # --- а) точные координаты из перехваченной модели imx ---
            exact = {}
            imx_used = None
            imx_trusted = False
            imx_info = None
            # раунд 52: прямой разбор модели — флип по visualizations.scale.y,
            # заглушки (0,0)/низкая уверенность — без координат
            for imx_name, imx_obj in (self._captured_imx_from_network or {}).items():
                try:
                    info = self._imx_pano_meta(imx_obj, fid)
                except Exception as _ie:
                    self.log_msg(f"[план][imx] этаж «{floor_name}»: разбор модели: {_ie}")
                    info = None
                if not info:
                    continue
                good = {pid: v["xy"] for pid, v in info["panos"].items()
                        if pid in floor_ids and v["ok"]}
                if not good:
                    continue
                imx_info = info
                if info["flip"] is not None:
                    exact = {pid: (x, -y if info["flip"] else y) for pid, (x, y) in good.items()}
                    imx_used = "%s (visualizations.scale.y %s)" % (
                        imx_name, "< 0 → Y вверх, флип" if info["flip"] else "> 0 → Y вниз")
                    imx_trusted = True
                else:
                    _best = None
                    for _flip in (True, False):
                        _conv = {pid: (x, -y if _flip else y) for pid, (x, y) in good.items()}
                        _sc = self._imx_room_score(_conv, geom, room_of_pano)
                        if _best is None or _sc > _best[0]:
                            _best = (_sc, _flip, _conv)
                    exact = _best[2]
                    imx_used = "%s (по комнатам: %s, в своей комнате %d)" % (
                        imx_name, "Y вверх, флип" if _best[1] else "Y вниз", _best[0])
                    imx_trusted = _best[0] > 0
                _skip = sorted((links_by_id.get(pid) or {}).get("n") or 0
                               for pid, v in info["panos"].items()
                               if pid in floor_ids and not v["ok"])
                if _skip:
                    self.log_msg(f"[план][imx] этаж «{floor_name}»: без координат в модели "
                                 f"(уверенность < {info['minconf']:.2f} / заглушка 0,0): № {_skip}")
                break
            self._imx_trusted_floor = fid if imx_trusted else None
            if not exact:
                for imx_name, imx_obj in (self._captured_imx_from_network or {}).items():
                    raw = self._extract_imx_pano_positions(
                        imx_obj, [p.get("entityId") for p in floor_panos]
                    )
                    if not raw:
                        continue
                    meta = geom.get("meta") or {}
                    sx, sy = meta.get("data-scale-x"), meta.get("data-scale-y")
                    ox, oy = meta.get("data-offset-x"), meta.get("data-offset-y")

                    def to_meters(v, use_meta, flip_y):
                        x, y = v
                        if use_meta and None not in (sx, sy, ox, oy):
                            return (x * sx + ox, y * sy + oy)
                        return (x, -y if flip_y else y)

                    for label, use_meta, flip in (
                        (f"{imx_name} (meta scale/offset)", True, False),
                        (f"{imx_name} (уже метры, Y вниз)", False, False),
                        (f"{imx_name} (уже метры, Y вверх)", False, True),
                    ):
                        conv = {pid: to_meters(v, use_meta, flip) for pid, v in raw.items()}
                        inside = sum(
                            1 for x, y in conv.values()
                            if vbX - 1 <= x <= vbX + vbW + 1 and vbY - 1 <= y <= vbY + vbH + 1
                        )
                        _sx = (max(x for x, _ in conv.values()) - min(x for x, _ in conv.values())) if conv else 0.0
                        _sy = (max(y for _, y in conv.values()) - min(y for _, y in conv.values())) if conv else 0.0
                        _spread = (_sx ** 2 + _sy ** 2) ** 0.5
                        # раунд 46: «внутри viewBox» недостаточно — куча из-за
                        # константного floorplanMeters тоже внутри; требуем разброс
                        if conv and inside / len(conv) >= 0.6 and (len(conv) < 3 or _spread >= 1.5):
                            exact = conv
                            imx_used = label
                            break
                        if conv and inside / len(conv) >= 0.6:
                            self.log_msg(
                                "[план][showcase] этаж «%s»: вариант «%s» отброшен — "
                                "позиции в куче %.1fx%.1f м" % (floor_name, label, _sx, _sy))
                    if exact:
                        try:
                            with open(os.path.join(ARCHIVE_DIR, "imx_model.json"), "w", encoding="utf-8") as fh:
                                json.dump(self._captured_imx_from_network, fh, ensure_ascii=False)
                        except Exception:
                            pass
                        break
            if exact:
                self.log_msg(
                    f"[план][showcase] этаж «{floor_name}»: точные координаты из перехваченной "
                    f"модели, вариант пересчёта: {imx_used} ({len(exact)} панорам)"
                )

            if imx_info:
                _hn = []
                for _p in floor_panos:
                    _pid = _p.get("entityId")
                    _v = imx_info["panos"].get(_pid)
                    _l = links_by_id.get(_pid)
                    if not _v or _l is None:
                        continue
                    if (not _v["ok"]) or _v["outdoor"]:
                        _l["hidden_on_plan"] = True
                        _hn.append(_l.get("n"))
                    else:
                        _l.pop("hidden_on_plan", None)
                self.log_msg(f"[план][imx] этаж «{floor_name}»: скрытые (Zillow их не рисует: "
                             f"нет позиции / улица): № {sorted(x for x in _hn if x)}")

            # --- б) центроиды комнат ---
            meters = {}
            src_of = {}
            for p in floor_panos:
                pid = p.get("entityId")
                if pid in exact:
                    meters[pid] = exact[pid]
                    src_of[pid] = "imx"
                    continue
                c = self._room_center_meters_from_geometry(geom, room_of_pano.get(pid))
                if c:
                    meters[pid] = c
                    src_of[pid] = room_of_pano.get(pid)

            # --- в) панорамы без позиции — среднее соседей по графу переходов ---
            unmapped = [p.get("entityId") for p in floor_panos if p.get("entityId") not in meters]
            for _ in range(4):
                if not unmapped:
                    break
                still = []
                for pid in unmapped:
                    nb_pos = [meters[nb] for nb in neighbors.get(pid, []) if nb in meters]
                    if nb_pos:
                        meters[pid] = (
                            sum(v[0] for v in nb_pos) / len(nb_pos),
                            sum(v[1] for v in nb_pos) / len(nb_pos),
                        )
                        src_of[pid] = "neighbors"
                    else:
                        still.append(pid)
                unmapped = still

            # --- г) последние без позиции: панорамы вообще без комнаты
            # (в allPanosToRooms их нет — так бывает у этажей-«шахт»
            # таунхаусов: вход + лестница, 5151 W Redondo, Floor 1) — ставим
            # в центр жилой площади этажа: среднее центроидов roomShape
            # (флип Y!), при их отсутствии — центр viewBox. Точка одна на
            # все такие панорамы — геометрически честно («где-то здесь»),
            # точную подгонку можно сделать вручную кнопкой «На план» в
            # viewer.
            still = [p.get("entityId") for p in floor_panos if p.get("entityId") not in meters]
            if still:
                fb = None
                if geom.get("roomshapes"):
                    xs = [c["centroid"][0] for c in geom["roomshapes"].values()]
                    ys = [-c["centroid"][1] for c in geom["roomshapes"].values()]
                    fb = (sum(xs) / len(xs), sum(ys) / len(ys))
                else:
                    fb = (vbX + vbW / 2.0, vbY + vbH / 2.0)
                for pid in still:
                    meters[pid] = fb
                    src_of[pid] = "floor"
                self.log_msg(
                    f"[план][showcase] этаж «{floor_name}»: {len(still)} панорам без комнаты и "
                    f"соседей — ставлю в центр площади этажа ({fb[0]:.2f}, {fb[1]:.2f}) м"
                )

            # --- г2) привязка по подписи комнаты на плане (раунд 20) ---
            # В SVG заметок есть текст («Bedroom», «Stairs (Down)», «Laundry
            # Room»...) — те самые подписи, что Zillow показывает на плане.
            # Панорамы, имя комнаты которых совпадает с подписью, ставим
            # внутрь ПОЛИГОНА ИМЕННО ЭТОЙ комнаты: лестницы — в комнатах
            # лестниц, спальни — в спальнях (а не кучей в ванной рядом —
            # 5151 W Redondo, F2/F3). Несколько камер одной комнаты
            # расходятся от якоря детерминированной спиралью (~0.55 м),
            # оставаясь внутри полигона.
            def _room_key(s):
                if not s:
                    return None
                t = re.sub(r"\([^)]*\)", " ", str(s).lower())
                t = re.sub(r"[^a-zа-я0-9 ]+", " ", t)
                return re.sub(r"\s+", " ", t).strip() or None

            def _key_eq(a, b):
                if a == b:
                    return True
                # «Living» ↔ «Living Room», «Laundry» ↔ «Laundry Room»
                return len(a) >= 5 and (a.startswith(b) or b.startswith(a))

            note_texts = geom.get("notetexts") or {}
            key_to_rids = {}
            for rid, rs in (geom.get("roomshapes") or {}).items():
                k = _room_key(note_texts.get(rid))
                if k:
                    key_to_rids.setdefault(k, []).append(rid)

            def _rids_for(k):
                out = []
                for kk, rids in key_to_rids.items():
                    if _key_eq(kk, k):
                        out.extend(rids)
                return out

            if key_to_rids:
                IMMOB = ("imx", "neighbors", "floor")
                # занятость заметок уже стоящими «комнатными» панорамами
                occ = {}
                for p in floor_panos:
                    pid = p.get("entityId")
                    if pid not in meters or src_of.get(pid) in IMMOB:
                        continue
                    rid0 = src_of.get(pid)
                    dr = ((geom.get("notes") or {}).get(rid0) or {}).get("data_room") or rid0
                    if dr in (geom.get("roomshapes") or {}):
                        occ[dr] = occ.get(dr, 0) + 1
                renamed = 0
                groups = {}
                for p in floor_panos:
                    pid = p.get("entityId")
                    # переставляем ТОЛЬКО «приблизительные» (interp/floor);
                    # стоящие по data_room/imx не трогаем — они и так в
                    # своих комнатах (учтены в occ выше)
                    if pid not in meters or src_of.get(pid) not in ("neighbors", "floor"):
                        continue
                    k = _room_key(p.get("room") or p.get("title"))
                    rids = _rids_for(k) if k else []
                    if rids:
                        groups.setdefault(tuple(sorted(rids)), []).append(pid)
                for rids_t, pids_g in groups.items():
                    rids_sorted = sorted(rids_t, key=lambda r: (geom["roomshapes"][r]["centroid"][0], r))
                    pids_sorted = sorted(pids_g, key=lambda q: (meters[q][0], meters[q][1], q))
                    for i, pid in enumerate(pids_sorted):
                        rid = rids_sorted[i % len(rids_sorted)]
                        k_idx = occ.get(rid, 0)
                        occ[rid] = k_idx + 1
                        poly = geom["roomshapes"][rid].get("polygon")
                        if not poly or len(poly) < 3:
                            continue
                        fpoly = [(x, -y) for (x, y) in poly]
                        anchor = self._polygon_anchor(fpoly)
                        if not anchor:
                            continue
                        if k_idx:
                            ang = k_idx * 2.399963
                            rad = 0.55 * math.sqrt(k_idx)
                            anchor = self._snap_point_into_polygons(
                                (anchor[0] + rad * math.cos(ang), anchor[1] + rad * math.sin(ang)),
                                [(fpoly, anchor)],
                            )
                        meters[pid] = anchor
                        src_of[pid] = rid
                        renamed += 1
                if renamed:
                    self.log_msg(
                        f"[план][showcase] этаж «{floor_name}»: по подписям комнат на плане "
                        f"переставлено в свои комнаты: {renamed}"
                    )

            # --- б2) точки Zillow со скриншота-эталона (раунд 22) ---
            # Пользовательский приём: «скриншот родного плана Zillow с
            # камерами → накладываем на наш план → точки и есть позиции
            # камер». Если рядом с граббером лежит ref_floor_<floorId>.png
            # (скриншот эталонного плана этажа с синими точками Zillow) —
            # находим точки по цвету, совмещаем с геометрией SVG и ставим
            # панорамы ТОЧНО на точки Zillow (назначение по комнате пано).
            ref_png = None
            for _cand in (f"ref_floor_{fid}.png", f"ref_{fid}.png"):
                _pth = os.path.join(ARCHIVE_DIR, _cand)
                if os.path.exists(_pth):
                    ref_png = _pth
                    break
            if not ref_png:
                # автоскриншоты ИЗ ТУРА (раунд 24, вкладка Floors) — по
                # номеру из имени этажа или по позиции этажа; затем —
                # автоскриншоты панели карточки (раунд 23)
                _nm = re.sub(r"[^a-z0-9а-яё]+", "", (floor_name or "").lower())
                _fpos = list(src_floors.keys()).index(fid) + 1
                _mnum = re.search(r"(\d+)", floor_name or "")
                _cands = []
                if _mnum:
                    _cands.append(f"ref_tour_floor{_mnum.group(1)}.png")
                _cands.extend((
                    f"ref_tour_floor{_fpos}.png",
                    f"ref_panel_{_nm}.png",
                    f"ref_panel_{_fpos}.png",
                    "ref_panel_single.png",
                ))
                for _cand in _cands:
                    _pth = os.path.join(ARCHIVE_DIR, _cand)
                    if os.path.exists(_pth):
                        ref_png = _pth
                        break
            if ref_png:
                _area, _dots_px = self._cached_ref_dots(ref_png)  # раунд 54: кэш
                _tr = self._align_png_to_geometry(
                    ref_png, geom, plan_png=png_path, plan_wh=(w, h)) if _dots_px else None
                if _dots_px and _tr:
                    _dots_m = [_tr(d[0], d[1]) for d in _dots_px]
                    self.log_msg(
                        f"[план][showcase] этаж «{floor_name}»: на эталоне "
                        f"{os.path.basename(ref_png)} найдено синих точек Zillow: "
                        f"{len(_dots_px)} — совмещаю с планом"
                    )
                    # раунд 51: граф переходов (departureAngle) ↔ точки Zillow
                    _graph_ok = False
                    try:
                        _graph_ok = self._place_panos_by_dot_graph(
                            floor_panos, meters, src_of, room_of_pano, geom,
                            _dots_m, floor_name, fid, links_by_id)
                    except Exception as _ge:
                        self.log_msg("[план][граф] этаж «%s»: ошибка решателя: %s — "
                                     "прежний путь" % (floor_name, _ge))
                    if not _graph_ok:
                        _ptitle = {
                            p.get("entityId"): (p.get("room") or p.get("title"))
                            for p in floor_panos
                        }
                        self._apply_zillow_dot_positions(
                            floor_panos, meters, src_of, room_of_pano, geom,
                            _dots_m, floor_name, _ptitle,
                        )
                        # раунд 47: классификация видимых/скрытых — НЕЗАВИСИМЫЙ
                        # матч панорама↔точка (жадный 1:1, порог 2.0 м). Прежний
                        # подход «расстояние до любой точки <=1.2 м» зависел от
                        # точности совмещения скриншота с геометрией (bbox стен):
                        # сдвиг совмещения делал все панели скрытыми (F3 15.26).
                        # Позиции НЕ переносим: imx-метры точнее совмещения.
                        _vis = _hid = 0
                        _ids = [_p.get("entityId") for _p in floor_panos
                                if _p.get("entityId") in meters
                                and links_by_id.get(_p.get("entityId")) is not None]

                        def _match(_dots, _thr):
                            _used = [False] * len(_dots)
                            _assign = {}
                            _on = set()
                            _pp = []
                            for _pid in _ids:
                                for _di, (_dx, _dy) in enumerate(_dots):
                                    _d2 = (meters[_pid][0] - _dx) ** 2 + (meters[_pid][1] - _dy) ** 2
                                    if _d2 <= _thr * _thr:
                                        _pp.append((_d2, _pid, _di))
                            _pp.sort(key=lambda t: (t[0], t[1], t[2]))
                            for _d2, _pid, _di in _pp:
                                if _used[_di] or _pid in _on:
                                    continue
                                _used[_di] = True
                                _on.add(_pid)
                                _assign[_pid] = _di
                            return _on, _pp, _assign

                        # раунд 49: совмещение скриншота с геометрией (bbox стен)
                        # даёт сдвиг, плавающий по этажам (F3: 7 точек, сматчилась
                        # 1 порогом 2.0 м). Шаг 1: матч порогом 3.0 м; шаг 2: если
                        # >=2 пар — медианный сдвиг пар и ТОЧКИ сдвигаются на него
                        # (панорамы не трогаем), перематч порогом 1.5 м.
                        _on_dot, _pairs0, _assign0 = _match(_dots_m, 3.0)
                        _final_dots = _dots_m
                        _final_assign = _assign0
                        if len(_pairs0) >= 2:
                            _dxs = sorted(meters[_pid][0] - _dots_m[_di][0] for _, _pid, _di in _pairs0)
                            _dys = sorted(meters[_pid][1] - _dots_m[_di][1] for _, _pid, _di in _pairs0)
                            _mdx = _dxs[len(_dxs) // 2]
                            _mdy = _dys[len(_dys) // 2]
                            if _mdx * _mdx + _mdy * _mdy > 0.04:
                                self.log_msg(
                                    "[план][showcase] этаж «%s»: поправка совмещения "
                                    "(%.2f, %.2f) м — перематчиваю точки" % (floor_name, _mdx, _mdy))
                                _dots2 = [(dx + _mdx, dy + _mdy) for dx, dy in _dots_m]
                                _on_dot, _, _assign1 = _match(_dots2, 1.5)
                                _final_dots = _dots2
                                _final_assign = _assign1
                        _snapped = 0
                        if _dots_m and not _on_dot:
                            self.log_msg(
                                "[план][showcase] этаж «%s»: точки есть (%d), но ни одна "
                                "панорама не сматчилась — fail-safe: считаю все видимыми "
                                "(совмещение скриншота сорвалось)" % (floor_name, len(_dots_m)))
                            _on_dot = set(_ids)
                        for _pid in _ids:
                            _lr = links_by_id.get(_pid)
                            if _pid in _on_dot:
                                _lr.pop("hidden_on_plan", None)
                                _vis += 1
                                if _pid in _final_assign:
                                    _nd = _final_dots[_final_assign[_pid]]
                                    if (meters[_pid][0] - _nd[0]) ** 2 + (meters[_pid][1] - _nd[1]) ** 2 > 0.36:
                                        meters[_pid] = _nd
                                        src_of[_pid] = "zdot_snapped"
                                        _snapped += 1
                            else:
                                _lr["hidden_on_plan"] = True
                                _hid += 1
                                _rc = self._room_center_meters_from_geometry(
                                    geom, room_of_pano.get(_pid))
                                if _rc:
                                    meters[_pid] = _rc
                                    src_of[_pid] = "room_hidden"
                        self.log_msg(
                            f"[план][showcase] этаж «{floor_name}»: на точках Zillow: "
                            f"{_vis}, скрытых (не показаны Zillow): {_hid}, поставлено на точки: {_snapped}"
                        )
                elif _dots_px:
                    self.log_msg(
                        f"[план][showcase] этаж «{floor_name}»: на эталоне "
                        f"{os.path.basename(ref_png)} точек: {len(_dots_px)}, но "
                        f"совместить скриншот с планом не удалось (нет стен/комнат)"
                    )

            # --- д) разведение слипшихся камер (раунд 18) ---
            # Интерполяция «среднее соседей» и fallback «центр этажа» могут
            # дать НЕСКОЛЬКОМ панорамам ОДНУ И ТУ ЖЕ точку (5151 W Redondo:
            # вся лестница 2-го этажа + ванная + холл — в одном пикселе;
            # маркеры слипаются, клик по ним открывает «не ту» панораму —
            # «ванная багует»). Надёжные позиции (imx/room) неподвижны,
            # подвижные (neighbors/floor) мягко расталкиваются до минимального
            # расстояния; детерминированно (без рандома).
            PRIO = {"imx": 0, "room": 1, "neighbors": 2, "floor": 3}
            MIN_DIST = 0.9  # метров между камерами
            # полигоны ПОЛА этажа (roomShape, отрисованные координаты, Y вниз):
            # камеры обязаны оставаться внутри помещений — viewBox шире контура
            # дома, и кламп по нему оставлял камеры висеть снаружи плана
            floor_polys = []
            for rs in (geom.get("roomshapes") or {}).values():
                raw = rs.get("polygon")
                if raw and len(raw) >= 3:
                    poly = [(px, -py) for (px, py) in raw]
                    floor_polys.append((poly, self._polygon_anchor(poly)))
            all_ids = [p.get("entityId") for p in floor_panos if p.get("entityId") in meters]
            movable = [
                pid for pid in all_ids
                if src_of.get(pid, "room") in ("neighbors", "floor")
            ]
            if len(all_ids) > 1 and movable:
                for _pass in range(80):
                    moved = False
                    for a in movable:
                        for b in all_ids:
                            if b == a:
                                continue
                            pa, pb = meters[a], meters[b]
                            dx, dy = pa[0] - pb[0], pa[1] - pb[1]
                            dist = math.hypot(dx, dy)
                            if dist >= MIN_DIST:
                                continue
                            if dist < 1e-6:
                                # совпали точно: детерминированный сдвиг по
                                # положению в списке
                                k = (all_ids.index(a) + 1) / (len(all_ids) + 1.0)
                                dx, dy = 0.30 * math.cos(2 * math.pi * k), 0.22 * math.sin(2 * math.pi * k)
                                dist = math.hypot(dx, dy)
                            push = (MIN_DIST - dist)
                            b_movable = src_of.get(b, "room") in ("neighbors", "floor")
                            if b_movable:
                                half = push / 2.0
                                meters[a] = (pa[0] + dx / dist * half, pa[1] + dy / dist * half)
                                meters[b] = (pb[0] - dx / dist * half, pb[1] - dy / dist * half)
                            else:
                                meters[a] = (pa[0] + dx / dist * push, pa[1] + dy / dist * push)
                            moved = True
                    if not moved:
                        break
                    # раунд 19: после каждого прохода возвращаем камеры ВНУТРЬ
                    # помещений (ближайшая точка пола) — расталкивание больше
                    # не выносит их за стены дома
                    if floor_polys:
                        for pid in movable:
                            meters[pid] = self._snap_point_into_polygons(meters[pid], floor_polys)
                # финальное удержание внутри пола (и как раньше — в viewBox)
                for pid in movable:
                    x, y = meters[pid]
                    x = min(max(x, vbX + 0.02), vbX + vbW - 0.02)
                    y = min(max(y, vbY + 0.02), vbY + vbH - 0.02)
                    if floor_polys:
                        x, y = self._snap_point_into_polygons((x, y), floor_polys)
                    meters[pid] = (x, y)
                self.log_msg(
                    f"[план][showcase] этаж «{floor_name}»: разведено слипшихся камер: "
                    f"{len(movable)} (мин. расстояние {MIN_DIST} м)"
                )

            applied = {"imx": 0, "room": 0, "floor": 0, "interpolated": 0, "none": 0}
            for p in floor_panos:
                pid = p.get("entityId")
                link = links_by_id.get(pid)
                if link is None:
                    continue
                m = meters.get(pid)
                if not m:
                    applied["none"] += 1
                    continue
                x, y = m
                if not (vbX - 2 <= x <= vbX + vbW + 2 and vbY - 2 <= y <= vbY + vbH + 2):
                    applied["none"] += 1
                    continue
                tag = src_of.get(pid) or "room"
                if tag == "imx":
                    ptype = "showcase_floor_svg_imx"
                    bucket = "imx"
                elif tag == "neighbors":
                    ptype = "showcase_floor_svg_interp"
                    bucket = "interpolated"
                elif tag == "floor":
                    ptype = "showcase_floor_svg_floor"
                    bucket = "floor"
                else:
                    ptype = "showcase_floor_svg_room"
                    bucket = "room"
                link["plan_file"] = png_file
                link["plan_px"] = {
                    "x": round((x - vbX) / vbW * w, 1),
                    "y": round((y - vbY) / vbH * h, 1),
                }
                link["plan_type"] = ptype
                extra = link.setdefault("extra", {})
                extra["floorplanMeters"] = {"x": round(x, 3), "y": round(y, 3)}
                if tag not in ("imx", "neighbors"):
                    extra["floorplanRoomId"] = tag
                applied[bucket] += 1

            for k in total_stats:
                total_stats[k] += applied[k]
            # Раунд 17: ВСЕ ссылки этажа получают растровый план этажа
            # (даже те редкие, что остались без px): раньше «осиротевшие»
            # ссылки держали plan_file=plan_listing.svg (SVG, не растр) —
            # viewer не мог показать такой этаж вовсе (5151 W Redondo,
            # Floor 1: «1й этаж не отображается», уровни сдвигались).
            for p in floor_panos:
                l2 = links_by_id.get(p.get("entityId"))
                if l2 and not l2.get("plan_file"):
                    l2["plan_file"] = png_file
                    if not l2.get("plan_type") or l2["plan_type"].startswith("listing_"):
                        l2["plan_type"] = "showcase_floor_plan_only"
            self.log_msg(
                f"[план][showcase] этаж «{floor_name}»: plan_px проставлен — точных из imx: "
                f"{applied['imx']}, по центроидам комнат: {applied['room']}, центр этажа: "
                f"{applied['floor']}, интерполировано по соседям: {applied['interpolated']}, "
                f"без координат: {applied['none']}"
            )
        return total_stats

    def _get_image_pixel_size(self, path):
        """Реальные ширина/высота файла изображения в пикселях. Основное
        применение сейчас — контроль фактического размера PNG, растеризованного
        из inline SVG панели Floor Plan (_rasterize_plan_svgs_from_captures:
        размер задан нами в корне SVG, проверка ловит неожиданный CSS).
        Использует тот же необязательный Pillow, что уже требуется для
        разметки плана (_annotate_zillow_plans) и приблизительной схемы по
        углам (_draw_zillow_angle_schematic) — если Pillow не установлен,
        шаг просто пропускается (см. лог ниже), как и у них."""
        try:
            from PIL import Image
        except ImportError:
            self.log_msg(
                "[план][панель] Pillow не установлен — контроль размера PNG пропущен (pip install Pillow)"
            )
            return None
        try:
            with Image.open(path) as img:
                return img.size  # (width, height)
        except Exception as e:
            self.log_msg(f"[план][pano-point] не удалось прочитать размер {os.path.basename(path)}: {e}")
            return None

    def _rasterize_svg_to_png(self, page, svg_path, png_path, size=1600):
        """Рендерит локальный SVG-файл в PNG через тот же Chrome — без
        дополнительных зависимостей вроде cairosvg/svglib: открывает
        file://<svg_path> в новой вкладке того же браузерного контекста и
        снимает скриншот отрисованного <svg>. Нужно на объявлениях, где
        план с карточки приходит только как compressed.svg, без
        растрового hero.png (см. CONTEXT.md, п. B) — часть сторонних
        программ, открывающих .3dview, план без растрового файла не
        показывает вовсе, даже если сам .svg лежит в архиве.
        Возвращает True/False."""
        try:
            svg_page = page.context.new_page()
        except Exception as e:
            self.log_msg(f"[план][svg→png] не удалось открыть вкладку: {e}")
            return False
        try:
            try:
                svg_page.set_viewport_size({"width": size, "height": size})
            except Exception:
                pass
            file_url = "file://" + os.path.abspath(svg_path).replace(os.sep, "/")
            svg_page.goto(file_url, timeout=15000)
            svg_page.wait_for_timeout(300)
            # omit_background=True: у большинства планов Zillow сам <svg> не
            # задаёт свой собственный белый фон явно — он прилетает от
            # белого фона страницы/вьюпорта Chrome под ним. Без этого флага
            # снимок выходит с сплошной белой подложкой вокруг плана, которую
            # потом приходится убирать вручную в редакторе (см. viewer.html,
            # stripPlanWhiteBackground — там есть парная кнопка «прозрачный
            # фон» на случай архивов, снятых до этого исправления, либо если
            # план всё же пришёл с непрозрачным фоном другим путём).
            try:
                loc = svg_page.locator("svg").first
                if loc.count() > 0:
                    loc.screenshot(path=png_path, type="png", omit_background=True)
                else:
                    svg_page.screenshot(path=png_path, type="png", full_page=True, omit_background=True)
            except Exception:
                svg_page.screenshot(path=png_path, type="png", full_page=True, omit_background=True)
            ok = os.path.exists(png_path) and os.path.getsize(png_path) > 500
            if ok:
                self.log_msg(
                    f"[план][svg→png] {os.path.basename(svg_path)} → {os.path.basename(png_path)}"
                )
            else:
                self.log_msg(f"[план][svg→png] рендер {os.path.basename(svg_path)} не дал файла")
            return ok
        except Exception as e:
            self.log_msg(f"[план][svg→png] ошибка рендера {os.path.basename(svg_path)}: {e}")
            return False
        finally:
            try:
                svg_page.close()
            except Exception:
                pass

    def _download_listing_floor_plans_from_urls(self, urls):
        """Скачивает список URL планов. hero.png сохраняется как plan.png."""
        urls = list(urls or [])
        if not urls:
            return []

        tasks = []
        used_names = set()
        for i, url in enumerate(urls):
            path_part = url.split("?")[0]
            ext = os.path.splitext(path_part)[1].lower() or ".png"
            if ext not in (".svg", ".png", ".jpg", ".jpeg", ".webp"):
                ext = ".png"
            # главный план — всегда plan.png
            if "/hero." in url.lower() or (i == 0 and ext in (".png", ".jpg", ".jpeg", ".webp")):
                fname = "plan.png" if "plan.png" not in used_names else f"plan_{i + 1}{ext}"
            elif ext == ".svg":
                fname = "plan_listing.svg" if "plan_listing.svg" not in used_names else f"plan_listing_{i + 1}.svg"
            else:
                fname = f"plan_listing_{i + 1}{ext}"
            used_names.add(fname)
            path = os.path.join(ARCHIVE_DIR, fname)
            tasks.append(DownloadTask(url, path, label=f"Floor plan {fname}", meta={"fname": fname}))

        run_download_batch(tasks, self._cookies_header, self._referer or self._original_url, self.log_msg)

        files = []
        for t in tasks:
            if t.success:
                files.append(t.meta["fname"])
                self.log_msg(f"[план][listing] сохранён {t.meta['fname']} ← {t.url[:120]}")
                # URL → файл: чтобы showcase-блок мог переиспользовать РОВНО
                # тот файл, что соответствует его URL (раунд 16: раньше был
                # захардкожен plan_listing.svg, из-за чего план ВТОРОГО этажа
                # получал копию ПЕРВОГО — все камеры 2-го этажа оставались
                # без координат)
                try:
                    if self._listing_floor_plan_file_by_url is None:
                        self._listing_floor_plan_file_by_url = {}
                    self._listing_floor_plan_file_by_url[t.url.split("?")[0]] = t.meta["fname"]
                except Exception:
                    pass
                # floorId → файл (floor_shape/<floorId>/ в URL плана этажа)
                fm = re.search(r"/floor_shape/([0-9a-fA-F]+)/", t.url)
                if fm:
                    try:
                        if self._listing_floor_plan_by_floor is None:
                            self._listing_floor_plan_by_floor = {}
                        self._listing_floor_plan_by_floor.setdefault(fm.group(1), t.meta["fname"])
                    except Exception:
                        pass
            else:
                self.log_msg(f"[план][listing] не скачался: {t.url[:120]}")
        return files

    def _make_richmedia_response_handler(self):
        """Фабрика обработчика сетевых JSON-ответов для
        _start_network_richmedia_watch() — см. её докстринг за тем, почему
        это отдельный долгоживущий слушатель, а не разовая обёртка вокруг
        одного клика."""

        def _on_response(resp):
            try:
                ctype = (resp.headers or {}).get("content-type", "")
            except Exception:
                ctype = ""
            try:
                url = resp.url or ""
            except Exception:
                url = ""

            # --- JSON imx_<revision>.json / photo_loc_<revision>.json ---
            # (см. self._captured_imx_from_network): перехватываем ВСЕГДА,
            # даже если richMedia уже найден, — файл тянется самим
            # 3D-просмотрщиком и содержит точные координаты панорам.
            if "/vrmodels/" in url and (".json" in url.split("?")[0]):
                if "json" in ctype.lower():
                    try:
                        body_imx = resp.json()
                    except Exception:
                        body_imx = None
                    if body_imx is not None:
                        if self._captured_imx_from_network is None:
                            self._captured_imx_from_network = {}
                        key = url.split("/")[-1].split("?")[0]
                        self._captured_imx_from_network[key] = body_imx
                        self.log_msg(
                            f"[zillow][network] перехватил координаты модели: {key} "
                            f"({len(json.dumps(body_imx))} байт)"
                        )

            if self._captured_rich_media_from_network is not None:
                return
            if "json" not in ctype.lower():
                return
            try:
                body = resp.json()
            except Exception:
                return

            rm = _find_richmedia_in_obj(body)
            if rm is not None:
                self._captured_rich_media_from_network = rm
                self.log_msg(f"[zillow][network] похоже на richMedia в ответе: {url[:140]}")
                self._start_pano_prefetch(rm)  # раунд 54

            try:
                snippet = json.dumps(body, ensure_ascii=False)[:4000].lower()
            except Exception:
                snippet = ""
            if rm is not None or any(
                k in snippet for k in ("panoloc", "visualizations", "skyboxes", "departureangle")
            ):
                self._debug_capture_count += 1
                try:
                    out_path = os.path.join(
                        ARCHIVE_DIR, f"debug_captured_response_{self._debug_capture_count}.json"
                    )
                    with open(out_path, "w", encoding="utf-8") as f:
                        json.dump({"url": url, "body": body}, f, ensure_ascii=False, indent=2)
                    self.log_msg(f"[zillow][network] сохранил {out_path} — на случай, если тур не найдётся")
                except Exception:
                    pass

        return _on_response

    # ---------- раунд 54: фоновая предзагрузка панорам ----------
    def _start_pano_prefetch(self, rich_media):
        """Раунд 54 (разрешено пользователем — отступ от правила №3):
        как только richMedia пойман из сети (первые секунды), панорамы
        начинают качаться в фоне во временную папку arhive/_prefetch/ —
        параллельно со съёмкой планов. Имена файлов — ровно те же, что
        строит _process_zillow_richmedia(); там готовые файлы просто
        переносятся на место, докачивается только то, что не успело/не
        скачалось. Поколение (_pano_prefetch_gen) защищает следующий тур
        очереди от записи «чужих» файлов."""
        try:
            if getattr(self, "_pano_prefetch", None) is not None:
                return
            panos = (rich_media or {}).get("panos") or []
            jobs = []
            n = 0
            for p in panos:
                n += 1
                pid = p.get("entityId")
                urls = p.get("textureFileUrls") or {}
                src = urls.get("pano8k") or urls.get("pano4k")
                if not src or not pid:
                    continue
                ext = os.path.splitext(src.split("?")[0])[1] or ".avif"
                room_s = safe_room(p.get("title") or "")
                fname = f"{n}_{room_s}_{pid}{ext}" if room_s else f"{n}_{pid}{ext}"
                jobs.append((src, fname))
            if not jobs:
                return
            gen = object()
            self._pano_prefetch_gen = gen
            tmpdir = os.path.join(ARCHIVE_DIR, "_prefetch")
            os.makedirs(tmpdir, exist_ok=True)
            st = {"gen": gen, "dir": tmpdir, "done": {}, "t0": time.time(), "thread": None, "n": len(jobs)}
            cookies = self._cookies_header or ""
            referer = self._referer or getattr(self, "_original_url", "") or ""

            def one_job(job):
                src, fname = job
                if getattr(self, "_pano_prefetch_gen", None) is not gen:
                    return fname, False
                ok = download_file(src, os.path.join(tmpdir, fname), cookies, referer, None)
                return fname, ok

            def work():
                try:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                        for fname, ok in pool.map(one_job, jobs):
                            st["done"][fname] = ok
                    if getattr(self, "_pano_prefetch_gen", None) is gen:
                        self.log_msg("[скачивание][фон] панорам скачано заранее: %d/%d за %.1f с"
                                     % (sum(1 for v in st["done"].values() if v), len(jobs),
                                        time.time() - st["t0"]))
                except Exception as e:
                    self.log_msg(f"[скачивание][фон] ошибка фоновой загрузки: {e}")

            th = threading.Thread(target=work, daemon=True)
            st["thread"] = th
            self._pano_prefetch = st
            th.start()
            self.log_msg(f"[скачивание][фон] качаю {len(jobs)} панорам параллельно со съёмкой планов")
        except Exception as e:
            self.log_msg(f"[скачивание][фон] не стартовал: {e} — панорамы скачаются обычным порядком")

    def _take_prefetched_panos(self, pano_tasks):
        """Раунд 54: дождаться фоновой загрузки и перенести готовые файлы на
        место задач (task.success=True). Возвращает число принятых."""
        st = getattr(self, "_pano_prefetch", None)
        self._pano_prefetch = None
        if not st or st["gen"] is not getattr(self, "_pano_prefetch_gen", None):
            return 0
        th = st.get("thread")
        if th is not None and th.is_alive():
            self.log_msg("[скачивание][фон] жду окончания фоновой загрузки панорам (%d/%d готово)..."
                         % (sum(1 for v in st["done"].values() if v), st["n"]))
            th.join(timeout=600)
        got = 0
        for t in pano_tasks:
            fname = (t.meta or {}).get("fname")
            srcp = os.path.join(st["dir"], fname) if fname else None
            try:
                if fname and st["done"].get(fname) and os.path.exists(srcp) and os.path.getsize(srcp) > 200:
                    os.replace(srcp, t.path)
                    t.success = True
                    got += 1
            except Exception:
                pass
        self._pano_prefetch_gen = None
        shutil.rmtree(st["dir"], ignore_errors=True)
        self.log_msg(f"[скачивание][фон] принято из фоновой загрузки: {got}/{len(pano_tasks)}, "
                     f"докачиваю остальное: {len(pano_tasks) - got}")
        return got

    # ---------- раунд 54: кэш разбора эталонов ----------
    def _img_key(self, path):
        try:
            stt = os.stat(path)
            return (os.path.abspath(path), stt.st_mtime_ns, stt.st_size)
        except Exception:
            return None

    def _cached_wall_bbox(self, path):
        cache = self.__dict__.setdefault("_wall_bbox_cache", {})
        k = self._img_key(path)
        if k is not None and k in cache:
            return cache[k]
        r = self._wall_bbox_px(path)
        if k is not None:
            cache[k] = r
        return r

    def _cached_ref_dots(self, path):
        """(area, dots) эталона — из кэша, если фоновый разбор уже прошёл."""
        cache = self.__dict__.setdefault("_ref_dots_cache", {})
        k = self._img_key(path)
        if k is not None and k in cache:
            return cache[k]
        area = self._cached_wall_bbox(path)
        dots = self._detect_blue_dots_pil(path, area=area)
        if k is not None:
            cache[k] = (area, dots)
        return area, dots

    def _prefetch_ref_analysis(self, path):
        """Раунд 54: разбор эталона в фоновом потоке сразу после снимка —
        к постобработке результат уже в кэше."""
        def work():
            try:
                self._cached_ref_dots(path)
            except Exception:
                pass
        try:
            threading.Thread(target=work, daemon=True).start()
        except Exception:
            pass

    def _start_network_richmedia_watch(self, page):
        """Начинает слушать сетевые JSON-ответы страницы в поисках данных
        тура (см. _find_richmedia_in_obj) — и держит слушатель включённым
        на протяжении ВСЕЙ последовательности «открыть Floor Plan → нажать
        3D Home», а не только вокруг одного клика.

        Почему так: на интерактивном Floor Plan (см. скриншот
        пользователя — точки панорам уже нарисованы прямо поверх плана на
        вкладке «Floor Plan», до какого-либо клика по «3D Home») эти точки
        неоткуда взять, кроме как из данных о панорамах — значит, похоже,
        что нужный сетевой запрос может уйти ещё при открытии самого Floor
        Plan, а не только при переключении на «3D Home». Слушатель,
        подвешенный лишь на момент клика по «3D Home», рисковал пропустить
        именно этот, более ранний ответ.

        Что бы ни нашлось — ЛЮБОЙ JSON-ответ, в котором мелькают
        характерные для тура ключи (panoLoc, visualizations, skyboxes,
        departureAngle), сохраняется в ARCHIVE_DIR как
        debug_captured_response_N.json, даже если он не подошёл под форму
        richMedia целиком — эти файлы попадают в итоговый .3dview (а если
        тур так и не нашёлся — остаются в arhive/, см. _finalize).

        Найденное складывается в self._captured_rich_media_from_network —
        вызывающий код (_run_single) сам решает, когда его проверить и
        использовать. Останавливать слушатель — _stop_network_richmedia_watch()."""
        handler = self._make_richmedia_response_handler()
        page.on("response", handler)
        self._network_watch_page = page
        self._network_watch_handler = handler

    def _stop_network_richmedia_watch(self):
        if self._network_watch_page is not None and self._network_watch_handler is not None:
            try:
                self._network_watch_page.remove_listener("response", self._network_watch_handler)
            except Exception:
                pass
        self._network_watch_page = None
        self._network_watch_handler = None

    def _is_real_tour_url(self, url):
        """Настоящий URL тура (не about:blank / new-tab-page / карточка)."""
        if not url or not isinstance(url, str):
            return False
        u = url.lower().strip()
        if not u.startswith("http"):
            return False
        if any(x in u for x in ("about:blank", "new-tab-page", "chrome://", "chrome-error://")):
            return False
        # прямые URL туров
        if any(x in u for x in (
            "view-imx", "view-3d-home", "my.matterport.com", "matterport.com/show",
            "media-experiences", "3dhome", "tour",
        )):
            return True
        return False

    def _enter_3d_home_from_lightbox(self, page, ctx):
        """Из lightbox Floor Plan кликает вкладку «3D Home».
        Тур почти всегда грузится в iframe на ТОЙ ЖЕ странице — новую
        вкладку принимаем только если URL реально похож на тур.
        Возвращает (page, opened: bool)."""
        selectors = [
            '#pano-tab',
            'button[aria-label="view 3d home"]',
            'button[value="pano"]',
            '[aria-controls="pano-panel"]',
            'button:has-text("3D Home")',
            'a:has-text("3D Home")',
        ]
        pages_before = set(id(p) for p in ctx.pages)
        for selector in selectors:
            try:
                loc = page.locator(selector).first
                if loc.count() == 0:
                    continue
                try:
                    if not loc.is_visible(timeout=1500):
                        continue
                except Exception:
                    continue

                # Сетевой перехват (см. _start_network_richmedia_watch) уже
                # включён вызывающим кодом с момента открытия Floor Plan —
                # здесь просто кликаем; self._captured_rich_media_from_network
                # заполнится сам, если что-то похожее на richMedia прилетит
                # по сети (до, во время или сразу после этого клика).
                loc.click(timeout=4000)
                self.log_msg(f"[zillow] из Floor Plan → 3D Home ({selector})")
                # на части объявлений данные тура приходят в сети с
                # небольшой задержкой после клика — даём им время
                deadline = time.time() + 5.0
                while time.time() < deadline and self._captured_rich_media_from_network is None:
                    time.sleep(0.3)
                rich_media = self._captured_rich_media_from_network

                # новая вкладка — только если это реальный тур, не chrome://new-tab-page
                for p in ctx.pages:
                    if id(p) in pages_before or p is page:
                        continue
                    try:
                        purl = p.url or ""
                    except Exception:
                        continue
                    if self._is_real_tour_url(purl):
                        self.log_msg(f"[zillow] 3D Home открылся в новой вкладке: {purl[:120]}")
                        try:
                            page.close()
                        except Exception:
                            pass
                        return p, True
                    # мусорная вкладка — закрываем и остаёмся на исходной
                    self.log_msg(f"[zillow] игнорирую пустую вкладку: {purl[:80]}")
                    try:
                        p.close()
                    except Exception:
                        pass

                # тур в iframe / на этой же странице — логируем все фреймы,
                # чтобы при следующей неудаче было видно, появился ли
                # вообще какой-то новый фрейм тура (см. CONTEXT.md, п.6.A)
                try:
                    frame_urls = [fr.url for fr in page.frames]
                except Exception:
                    frame_urls = []
                self.log_msg(
                    "[zillow] 3D Home на той же странице — фреймы сейчас: "
                    + "; ".join(u[:100] for u in frame_urls if u)
                )
                if rich_media is None:
                    self.log_msg("[zillow] 3D Home на той же странице — жду данные тура в фреймах...")
                return page, True
            except Exception:
                continue
        return page, False

    def _download_listing_floor_plans(self):
        """Возвращает уже скачанные на карточке файлы плана (см.
        _open_and_capture_floor_plan). Если файлов ещё нет, но URL-ы есть —
        докачивает. Используется из _process_zillow."""
        if self._listing_floor_plan_files:
            return list(self._listing_floor_plan_files)
        files = self._download_listing_floor_plans_from_urls(self._listing_floor_plan_urls)
        self._listing_floor_plan_files = files
        return files

    def _world_to_pixel(self, center, bounds, scale):
        try:
            x_min, y_max = bounds.get("xMin"), bounds.get("yMax")
            sx, sy = scale.get("x"), scale.get("y")
            if None in (x_min, y_max, sx, sy) or sx == 0 or sy == 0:
                return None, None
            return round((center.get("x", 0) - x_min) / sx, 1), round((center.get("y", 0) - y_max) / sy, 1)
        except Exception:
            return None, None

    def _annotate_zillow_plans(self, plan_info_by_floor, links):
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            self.log_msg("[план] Pillow не установлен — разметка плана пропущена (pip install Pillow)")
            return
        for floor_id, info in plan_info_by_floor.items():
            fname = info.get("file")
            if not fname:
                continue
            path = os.path.join(ARCHIVE_DIR, fname)
            if not os.path.exists(path):
                continue
            try:
                img = Image.open(path).convert("RGB")
                w, h = img.size
                bounds, scale = info.get("bounds"), info.get("scale")
                if bounds and scale and scale.get("x") and scale.get("y"):
                    pred_w = abs((bounds.get("xMax", 0) - bounds.get("xMin", 0)) / scale["x"])
                    pred_h = abs((bounds.get("yMax", 0) - bounds.get("yMin", 0)) / scale["y"])
                    diff_w = abs(pred_w - w) / max(w, 1)
                    diff_h = abs(pred_h - h) / max(h, 1)
                    if diff_w > 0.1 or diff_h > 0.1:
                        self.log_msg(
                            f"[план][проверка] этаж {floor_id}: {w}x{h} vs расчётные {pred_w:.0f}x{pred_h:.0f} — "
                            f"расхождение {diff_w*100:.0f}%/{diff_h*100:.0f}%, координаты могут быть неточны!"
                        )
                    else:
                        self.log_msg(f"[план][проверка] этаж {floor_id}: {w}x{h} — формула похоже верна.")
                draw = ImageDraw.Draw(img)
                count = 0
                for link in links:
                    if (link.get("floor") or {}).get("id") != floor_id:
                        continue
                    px = link.get("plan_px") or {}
                    x, y = px.get("x"), px.get("y")
                    if x is None or y is None:
                        continue
                    r = 10
                    draw.ellipse([x - r, y - r, x + r, y + r], outline=(255, 0, 0), width=3)
                    draw.text((x + r + 3, y - r), link.get("room") or link.get("id", ""), fill=(255, 0, 0))
                    count += 1
                out_name = fname.replace(".png", "_annotated.png")
                img.save(os.path.join(ARCHIVE_DIR, out_name))
                self.log_msg(f"[план] размечено {count} точек → {out_name}")
            except Exception as e:
                self.log_msg(f"[план] ошибка разметки этажа {floor_id}: {e}")

    def _draw_zillow_angle_schematic(self, floor_id, floor_panos, floor_label, pano_num_by_id, entrance_pano_id=None):
        """ГИПОТЕЗА (в том же духе, что и склейка панорам Matterport с пометкой
        "_hypothesis" — см. stitch_equirect() выше): часть туров Zillow — как
        правило, более старый/простой формат без полноценной 3D-модели — не
        отдаёт вообще НИКАКИХ пространственных данных: ни готовой картинки
        плана (richMedia.visualizations), ни мировых координат панорам
        (panoLoc.world) — на практике это встречается в большинстве туров, а
        не как редкое исключение. Раньше в этом случае план просто не
        строился (архив выходил вообще без единого plan.png). Зато у панорам
        этого формата есть destinations[].departureAngle — угол ухода к
        каждому соседу (см. _ANGLE_KEYS/first_number()) — из него можно
        построить ПРИБЛИЖЁННУЮ схему графом: обход в ширину от входной точки
        этажа (floors[].entrancePanoId, если есть), каждый следующий сосед
        кладётся на условном одинаковом шаге от текущей точки в направлении
        departureAngle. Реальных расстояний между панорамами Zillow в этом
        формате не отдаёт вовсе, поэтому шаг только условный — при графе с
        развилками или петлями (несколько путей между одними и теми же
        комнатами) раскладка может накладываться сама на себя. Знак/система
        отсчёта угла тоже не проверены на реальном плане (эталонной картинки
        для сверки нет, в отличие от Matterport, где для угла колец был
        реальный .mpalace пользователя) — это лучшее предположение, а не
        подтверждённый факт, поэтому и в имени файла, и в links.json
        (plan_type) это помечено как "hypothesis", как и у аналогичных
        реконструкций в этом скрипте.

        Возвращает (имя_файла_или_None, {panoId: {"x":.., "y":..}})."""
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            self.log_msg("[план] Pillow не установлен — приблизительная схема по углам пропущена (pip install Pillow)")
            return None, {}

        pano_by_id = {p.get("entityId"): p for p in floor_panos if p.get("entityId")}
        if not pano_by_id:
            return None, {}

        # граф соседства в обе стороны: если A→B задан в данных, а B→A нет
        # (обычное дело у Zillow — угол ухода привязан к конкретному клику на
        # сайте, а не к самой физической связи), всё равно можно пройти в
        # обратную сторону при обходе для раскладки — азимут разворачиваем на
        # 180°, тем же приёмом, что symmetrizeNeighborLinks() в index.html.
        adj = {pid: [] for pid in pano_by_id}
        for pid, p in pano_by_id.items():
            for d in (p.get("destinations") or []):
                nb_id = d.get("destEntityId")
                if not nb_id or nb_id not in pano_by_id:
                    continue
                angle = first_number(d)
                adj[pid].append((nb_id, angle))
                rev_angle = None if angle is None else (angle + 180.0)
                adj.setdefault(nb_id, []).append((pid, rev_angle))

        step = 160.0
        start_id = entrance_pano_id if entrance_pano_id in pano_by_id else next(iter(pano_by_id))
        positions = {start_id: (0.0, 0.0)}
        queue = [start_id]
        while queue:
            cur_id = queue.pop(0)
            cx, cy = positions[cur_id]
            for nb_id, angle in adj.get(cur_id, []):
                if nb_id in positions:
                    continue
                a = math.radians(angle if angle is not None else 0.0)
                positions[nb_id] = (cx + step * math.sin(a), cy - step * math.cos(a))
                queue.append(nb_id)

        # панорамы этого этажа, не связавшиеся ни с одной другой через обход
        # выше (изолированные вершины графа — например, панорама вообще без
        # исходящих/входящих переходов) — раскладываем отдельным рядом снизу,
        # чтобы они не потерялись из плана совсем.
        if len(positions) < len(pano_by_id):
            max_y = max((y for _, y in positions.values()), default=0.0)
            stray_x = 0.0
            for pid in pano_by_id:
                if pid not in positions:
                    positions[pid] = (stray_x, max_y + step)
                    stray_x += step

        xs = [x for x, _ in positions.values()]
        ys = [y for _, y in positions.values()]
        x_min, x_max, y_min, y_max = min(xs), max(xs), min(ys), max(ys)
        span_x, span_y = max(x_max - x_min, 1.0), max(y_max - y_min, 1.0)
        margin, target = 90, 1400
        scale = target / max(span_x, span_y)
        img_w, img_h = int(span_x * scale) + margin * 2, int(span_y * scale) + margin * 2

        img = Image.new("RGB", (img_w, img_h), (255, 255, 255))
        draw = ImageDraw.Draw(img)

        def to_px(x, y):
            return margin + (x - x_min) * scale, img_h - margin - (y - y_min) * scale

        pixel_positions = {}
        for pid, (x, y) in positions.items():
            pixel_positions[pid] = to_px(x, y)

        # сами связи — линиями; без них голые точки почти нечитаемы, особенно
        # когда примерный шаг раскладки развёл соседние комнаты далеко
        # друг от друга.
        drawn_edges = set()
        for pid, neighbors in adj.items():
            if pid not in pixel_positions:
                continue
            for nb_id, _angle in neighbors:
                if nb_id not in pixel_positions:
                    continue
                edge_key = tuple(sorted((pid, nb_id)))
                if edge_key in drawn_edges:
                    continue
                drawn_edges.add(edge_key)
                x1, y1 = pixel_positions[pid]
                x2, y2 = pixel_positions[nb_id]
                draw.line([x1, y1, x2, y2], fill=(190, 190, 190), width=2)

        room_color_idx = {}
        for pid, (px, py) in pixel_positions.items():
            title = (pano_by_id.get(pid) or {}).get("title") or ""
            if title not in room_color_idx:
                room_color_idx[title] = len(room_color_idx) % len(ROOM_COLORS)
            color = ROOM_COLORS[room_color_idx[title]]
            r = 9
            draw.ellipse([px - r, py - r, px + r, py + r], fill=color, outline=(20, 20, 20), width=2)
            draw.text((px + r + 3, py - r), str(pano_num_by_id.get(pid, "")), fill=(20, 20, 20))

        legend_y = 10
        for title, idx in room_color_idx.items():
            draw.rectangle([10, legend_y, 26, legend_y + 16], fill=ROOM_COLORS[idx], outline=(20, 20, 20))
            draw.text((32, legend_y), title or "?", fill=(20, 20, 20))
            legend_y += 20

        fname = f"plan_schematic_hypothesis_{safe_filename(floor_label)}.png"
        img.save(os.path.join(ARCHIVE_DIR, fname))
        self.log_msg(
            f"[план][гипотеза] у этажа «{floor_label}» нет ни готовой картинки плана, ни мировых "
            f"координат панорам — построена приблизительная схема по углам переходов между "
            f"панорамами ({len(pixel_positions)} точек) → {fname}"
        )
        return fname, {pid: {"x": round(x, 1), "y": round(y, 1)} for pid, (x, y) in pixel_positions.items()}

    # ---------- Matterport ----------

    def _process_matterport(self, model_data):
        try:
            with open(RAW_DATA_PATH, "w", encoding="utf-8") as f:
                json.dump(model_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.log_msg(f"[данные] не удалось сохранить raw_data.json: {e}")

        queries = model_data.get("queries") or {}
        model_prefetch = ((queries.get("GetModelPrefetch") or {}).get("data") or {}).get("model") or {}
        root_prefetch = ((queries.get("GetRootPrefetch") or {}).get("data") or {}).get("model") or {}

        locations = model_prefetch.get("locations") or []
        floors = {f.get("id"): f for f in (root_prefetch.get("floors") or [])}
        rooms = {r.get("id"): r for r in (root_prefetch.get("rooms") or [])}
        loc_by_id = {loc.get("id"): loc for loc in locations if loc.get("id")}
        self._matterport_fill_missing_floors(locations, floors)

        self.log_msg(
            f"[данные] модель «{root_prefetch.get('name') or model_prefetch.get('id')}», "
            f"точек съёмки: {len(locations)}, комнат: {len(rooms)}, этажей: {len(floors)}"
        )
        if not locations:
            raise RuntimeError("locations пуст — нечего скачивать")

        try:
            import numpy  # noqa: F401
            have_numpy = True
        except ImportError:
            have_numpy = False
            self.log_msg("[панорама] numpy не установлен — склейка в эквиректангулярную панораму пропущена "
                          "(pip install numpy), 6 граней куба сохраняются как есть")

        # ---- фаза 1: собираем задачи на скачивание граней сразу для всех точек ----
        entries = []
        face_tasks = []
        n = 0
        for loc in locations:
            n += 1
            loc_id = loc.get("id")
            pano = loc.get("pano") or {}
            sweep_uuid = pano.get("sweepUuid")
            pano_label = pano.get("label") or str(loc.get("index") if loc.get("index") is not None else n)

            room_ref = loc.get("room") or {}
            room = rooms.get(room_ref.get("id")) if room_ref.get("id") else None
            room_tags = (room or {}).get("tags") or []
            room_name = room_label_from_tags(room_tags)

            floor_ref = loc.get("floor") or {}
            floor = floors.get(floor_ref.get("id")) if floor_ref.get("id") else None
            floor_label = (floor or {}).get("label")

            position = loc.get("position") or {}
            resolution, skybox = pick_best_skybox(pano.get("skyboxes"))
            # раунд 70: фото, загруженные как 360° (source=upload) и не размещённые в модели,
            # лежат в (0,0,0) — на плане их не рисуем
            zero_pos = all(abs(float(position.get(k) or 0)) < 1e-6 for k in ("x", "y", "z"))
            unplaced = (pano.get("placement") == "unplaced") or (pano.get("source") == "upload" and zero_pos)

            entry = {
                "n": n, "loc_id": loc_id, "sweep_uuid": sweep_uuid, "pano_label": pano_label,
                "room_name": room_name, "room_tags": room_tags, "floor_ref": floor_ref,
                "floor_label": floor_label, "position": position, "resolution": resolution,
                "room_ref": room_ref, "neighbor_loc_ids": loc.get("neighbors") or [],
                "face_tasks": [], "files": [], "base": None, "unplaced": unplaced,
                "yaw": None,
            }
            # поворот камеры вокруг вертикали (Z вверх): направление с мировым азимутом α
            # видно на круговой панораме на долготе lon = yaw − α (проверено по глубине 3D-модели)
            rot = pano.get("rotation") or {}
            try:
                entry["yaw"] = round(math.degrees(2 * math.atan2(float(rot["z"]), float(rot["w"]))), 2)
            except (KeyError, TypeError, ValueError):
                pass

            if sweep_uuid and skybox:
                room_s = safe_room(room_name or pano_label)
                base = f"{n}_{room_s}_{sweep_uuid}" if room_s else f"{n}_{sweep_uuid}"
                entry["base"] = base
                tmpl = skybox["urlTemplate"]
                for face_i in range(6):
                    face_url = tmpl.replace("<face>", str(face_i))
                    fname = f"{base}_face{face_i}.jpg"
                    fpath = os.path.join(ARCHIVE_DIR, fname)
                    entry["face_tasks"].append(DownloadTask(
                        face_url, fpath, label=f"{base} face{face_i}",
                        meta={"face_i": face_i, "fname": fname},
                    ))
            else:
                self.log_msg(
                    f"[пропуск] точка {n} «{room_name or pano_label}» (sweepUuid={sweep_uuid}) — нет "
                    f"доступной грани одним файлом (только тайлы/заблокировано)"
                )

            entries.append(entry)
            face_tasks.extend(entry["face_tasks"])

        # все грани всех точек — одним пулом, с автоповтором неудачных
        run_download_batch(face_tasks, self._cookies_header, self._referer, self.log_msg)

        # ---- фаза 2: применяем результаты, собираем links[], готовим склейку ----
        links = []
        mapping = {}
        plan_points = []
        stitch_jobs = []
        for entry in entries:
            n = entry["n"]
            sweep_uuid = entry["sweep_uuid"]
            room_name = entry["room_name"]
            pano_label = entry["pano_label"]

            files = []
            face_paths_ordered = [None] * 6
            ok_count = 0
            for t in entry["face_tasks"]:
                if t.success:
                    files.append(t.meta["fname"])
                    face_paths_ordered[t.meta["face_i"]] = t.path
                    ok_count += 1

            if entry["face_tasks"]:
                if have_numpy and ok_count == 6:
                    eq_base = os.path.join(ARCHIVE_DIR, f"{entry['base']}_equirect")
                    stitch_jobs.append((face_paths_ordered, eq_base, entry))
                self.log_msg(
                    f"[сохранено] точка {n} «{room_name or pano_label}» (sweepUuid={sweep_uuid}, "
                    f"качество={entry['resolution']}) — {ok_count}/6 граней"
                )
                if sweep_uuid:
                    mapping[sweep_uuid] = room_name or pano_label
            entry["files"] = files

            floor_ref = entry["floor_ref"]
            link = {
                "n": n,
                "platform": "matterport",
                "id": sweep_uuid,
                "locationId": entry["loc_id"],
                "room": room_name,
                "floor": {"id": floor_ref.get("id"), "label": entry["floor_label"]} if floor_ref.get("id") else None,
                "world": {"x": entry["position"].get("x"), "y": entry["position"].get("y"), "z": entry["position"].get("z")},
                "files": files,
                "plan_type": "schematic",
                "plan_px": None,
                "plan_file": None,  # заполняется ниже после отрисовки схемы
                "neighbors": [],  # заполняется вторым проходом
                "extra": {"resolution": entry["resolution"], "label": pano_label, "roomTags": entry["room_tags"]},
                "_neighbor_loc_ids": entry["neighbor_loc_ids"],
                "_floorId": floor_ref.get("id"),
            }
            if entry["yaw"] is not None:
                link["extra"]["panoYawDeg"] = entry["yaw"]
            if entry["unplaced"]:
                link["extra"]["unplaced"] = True
            links.append(link)
            entry["link"] = link

            pos = entry["position"]
            if pos.get("x") is not None and pos.get("y") is not None and not entry["unplaced"]:
                plan_points.append({
                    "x": pos["x"], "y": pos["y"], "fz": pos.get("z"),
                    "floorId": floor_ref.get("id"), "roomId": entry["room_ref"].get("id"), "n": n, "label": pano_label,
                })
        unplaced_n = [e["n"] for e in entries if e.get("unplaced")]
        if unplaced_n:
            self.log_msg(f"[данные] точки {', '.join(map(str, unplaced_n))} — отдельные 360°-фото, "
                         f"не размещённые в 3D-модели: панорамы сохранены, на плане не рисуются")

        # ---- склейка круговых панорам + сжатие граней в AVIF — параллельно ----
        # (склеиваем из исходных JPG, потом каждую грань пережимаем в AVIF и JPG удаляем)
        if stitch_jobs:
            self.log_msg(f"[панорама] склеиваю {len(stitch_jobs)} круговых панорам "
                         f"({'AVIF' if avif_mode() else 'JPG q' + str(EQUIRECT_JPG_QUALITY)})...")
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(3, len(stitch_jobs))) as pool:   # по памяти
                future_map = {pool.submit(stitch_equirect, face_paths, eq_base): entry
                              for face_paths, eq_base, entry in stitch_jobs}
                for fut in concurrent.futures.as_completed(future_map):
                    entry = future_map[fut]
                    try:
                        eq_name = fut.result()
                    except Exception as e:
                        eq_name = None
                        self.log_msg(f"[панорама] ошибка склейки точки {entry['n']}: {e}")
                    if eq_name:
                        entry["equirect"] = eq_name
        face_files = [(entry, fname) for entry in entries for fname in list(entry["files"]) if fname.endswith(".jpg")]
        if face_files and not avif_mode():
            self.log_msg(f"[сжатие] {AVIF_HINT}. Грани оставлены как есть (исходные JPG Matterport)")
        elif face_files:
            before = sum(os.path.getsize(os.path.join(ARCHIVE_DIR, f)) for _, f in face_files
                         if os.path.exists(os.path.join(ARCHIVE_DIR, f)))
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                results = list(pool.map(lambda ef: (ef[0], ef[1], compress_face_file(os.path.join(ARCHIVE_DIR, ef[1]))),
                                        face_files))
            for entry, old, new in results:
                entry["files"] = [new if f == old else f for f in entry["files"]]
            after = sum(os.path.getsize(os.path.join(ARCHIVE_DIR, f)) for entry in entries for f in entry["files"]
                        if os.path.exists(os.path.join(ARCHIVE_DIR, f)))
            self.log_msg(f"[сжатие] грани → AVIF: {before // 1024} КБ → {after // 1024} КБ")
        for entry in entries:
            if entry.get("equirect"):
                entry["files"].append(entry["equirect"])
            if entry.get("link") is not None:
                entry["link"]["files"] = entry["files"]
                if entry.get("equirect"):
                    entry["link"]["pano_file"] = entry["equirect"]

        # второй проход: граф соседей locationId → id/room
        for link in links:
            resolved = []
            for nb_id in link.pop("_neighbor_loc_ids"):
                nb = loc_by_id.get(nb_id)
                if not nb:
                    continue
                nb_pano = nb.get("pano") or {}
                nb_room_ref = nb.get("room") or {}
                nb_room = rooms.get(nb_room_ref.get("id")) if nb_room_ref.get("id") else None
                resolved.append({
                    "id": nb_pano.get("sweepUuid"),
                    "room": room_label_from_tags((nb_room or {}).get("tags")) or nb_pano.get("label"),
                })
            link["neighbors"] = resolved

        mesh_file = self._matterport_download_mesh(model_prefetch)
        mesh_plans = self._draw_mesh_plans(mesh_file, plan_points, floors) if mesh_file else {}
        rest = [p for p in plan_points if p["floorId"] not in mesh_plans]
        plan_file_by_floor = self._draw_schematic_plan(rest, floors, rooms) if rest else {}
        for fid, (fname, _tr) in mesh_plans.items():
            plan_file_by_floor[fid] = fname
        by_n = {p["n"]: p for p in plan_points}
        for link in links:
            fid = link.pop("_floorId")
            link["plan_file"] = plan_file_by_floor.get(fid)
            p = by_n.get(link["n"])
            if fid in mesh_plans and p is not None:
                tr = mesh_plans[fid][1]
                link["plan_type"] = "mesh"
                link["plan_px"] = {"x": round((p["x"] - tr["originX"]) * tr["pxPerMeter"], 1),
                                   "y": round((tr["originY"] - p["y"]) * tr["pxPerMeter"], 1)}

        meta = {
            "platform": "matterport",
            "sourceUrl": self._referer,
            "modelName": root_prefetch.get("name"),
            "address": (root_prefetch.get("publication") or {}).get("address"),
            "zpid": None,
            "counts": {"points": len(links), "rooms": len(rooms), "floors": len(floors)},
            "mesh": mesh_file,
            # план из 3D: plan_px = ((x - originX)·pxPerMeter, (originY - y)·pxPerMeter), x/y — world
            "plans": {fname: tr for fname, tr in mesh_plans.values()},
            "floorsInfo": [{"id": fid, "label": (f or {}).get("label"), "sequence": (f or {}).get("sequence"),
                            "meshId": (f or {}).get("meshId")} for fid, f in floors.items()],
        }
        return links, mapping, meta

    def _matterport_fill_missing_floors(self, locations, floors):
        """У части точек Matterport не указан этаж (floor=None) — раньше из-за этого рисовался
        лишний «этаж» с одной точкой. Берём этаж ближайшей по высоте (z) и положению точки."""
        known = [l for l in locations if (l.get("floor") or {}).get("id") and l.get("position")]
        fixed = 0
        for loc in locations:
            if (loc.get("floor") or {}).get("id") or not known:
                continue
            p = loc.get("position") or {}
            px, py, pz = (p.get("x") or 0), (p.get("y") or 0), (p.get("z") or 0)

            def dist(o):
                q = o.get("position") or {}
                return 4 * abs((q.get("z") or 0) - pz) + abs((q.get("x") or 0) - px) + abs((q.get("y") or 0) - py)
            best = min(known, key=dist)
            loc["floor"] = dict(best["floor"])
            fixed += 1
        if fixed:
            self.log_msg(f"[данные] точек без этажа: {fixed} — отнесены к этажу ближайшей точки")

    def _matterport_download_mesh(self, model_prefetch):
        """3D-модель (сетка .dam) — для построения настоящего 2D-плана. Берём самую лёгкую (обычно 50k).
        → имя файла в архиве или None."""
        meshes = ((model_prefetch.get("assets") or {}).get("meshes") or [])
        meshes = [m for m in meshes if m.get("url") and (m.get("status") in (None, "available"))]
        if not meshes:
            self.log_msg("[3D] ссылки на 3D-модель в данных нет — план будет по точкам")
            return None
        mesh = sorted(meshes, key=lambda m: str(m.get("resolution") or "zzz"))[0]
        fname = f"model_{safe_filename(str(mesh.get('resolution') or 'mesh'))}.{mesh.get('format') or 'dam'}"
        task = DownloadTask(mesh["url"], os.path.join(ARCHIVE_DIR, fname), label="3D-модель")
        failed = run_download_batch([task], self._cookies_header, self._referer, self.log_msg)
        if failed or not task.success:
            self.log_msg("[3D] 3D-модель не скачалась — план будет по точкам")
            return None
        self.log_msg(f"[3D] 3D-модель сохранена: {fname} ({os.path.getsize(task.path) // 1024} КБ)")
        return fname

    def _draw_mesh_plans(self, mesh_file, plan_points, floors):
        """Раунд 70: настоящий 2D-план каждого этажа из 3D-модели .dam (срез стен).
        → {floorId: (имя PNG, преобразование)}; этажи, которые не вышли, — пустые (будет схема по точкам)."""
        result = {}
        try:
            import numpy  # noqa: F401
            from PIL import Image  # noqa: F401
        except ImportError:
            self.log_msg("[план] нужен numpy и Pillow для плана из 3D — будет схема по точкам")
            return result
        t0 = time.time()
        try:
            P, F = load_dam_mesh(os.path.join(ARCHIVE_DIR, mesh_file))
        except Exception as e:
            self.log_msg(f"[план] 3D-модель не прочиталась ({e}) — будет схема по точкам")
            return result
        self.log_msg(f"[план] 3D-модель: {len(P)} вершин, {len(F)} треугольников")
        levels = floor_levels_from_points(plan_points)
        order = sorted(levels.items(), key=lambda kv: kv[1])
        multi = len(order) > 1
        for i, (fid, fz) in enumerate(order):
            ceil_z = order[i + 1][1] if i + 1 < len(order) else None
            label = (floors.get(fid) or {}).get("label") or f"Floor {i + 1}"
            fname = f"plan_{safe_filename(label)}.png" if multi else "plan.png"
            cams = [(p["x"], p["y"]) for p in plan_points if p["floorId"] == fid]
            stand = [p.get("fz") for p in plan_points if p["floorId"] == fid]
            try:
                tr = render_mesh_plan(P, F, fz, ceil_z, cams, os.path.join(ARCHIVE_DIR, fname),
                                      label=label, stand_z=stand)
                tr["floorZ"] = round(fz, 3)
                result[fid] = (fname, tr)
                self.log_msg(f"[план] этаж «{label}»: план из 3D-модели → {fname} "
                             f"({tr['width']}×{tr['height']}, {tr['pxPerMeter']:.0f} px/м, пол z={fz:.2f} м)")
            except Exception as e:
                self.log_msg(f"[план] этаж «{label}»: план из 3D не вышел ({e}) — будет схема по точкам")
        self.log_msg(f"[план] план из 3D построен за {time.time() - t0:.1f} с")
        return result

    def _draw_schematic_plan(self, plan_points, floors, rooms):
        """Своя схема расположения точек — у Matterport нет готовой
        картинки плана (в отличие от Zillow), план рисуется у них на
        лету из 3D. Берём мировые X/Y (Z — высота), группируем по
        этажу, красим по комнате. Возвращает {floorId: filename}."""
        result = {}
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            self.log_msg("[план] Pillow не установлен — своя схема пропущена (pip install Pillow)")
            return result

        by_floor = {}
        for p in plan_points:
            by_floor.setdefault(p["floorId"], []).append(p)

        room_color_idx = {}
        for floor_id, pts in by_floor.items():
            xs, ys = [p["x"] for p in pts], [p["y"] for p in pts]
            x_min, x_max, y_min, y_max = min(xs), max(xs), min(ys), max(ys)
            span_x, span_y = max(x_max - x_min, 0.5), max(y_max - y_min, 0.5)
            margin, target = 80, 1400
            scale = target / max(span_x, span_y)
            img_w, img_h = int(span_x * scale) + margin * 2, int(span_y * scale) + margin * 2

            img = Image.new("RGB", (img_w, img_h), (255, 255, 255))
            draw = ImageDraw.Draw(img)

            def to_px(x, y):
                return margin + (x - x_min) * scale, img_h - margin - (y - y_min) * scale

            for p in pts:
                rid = p["roomId"]
                if rid not in room_color_idx:
                    room_color_idx[rid] = len(room_color_idx) % len(ROOM_COLORS)
                color = ROOM_COLORS[room_color_idx[rid]]
                x, y = to_px(p["x"], p["y"])
                r = 9
                draw.ellipse([x - r, y - r, x + r, y + r], fill=color, outline=(20, 20, 20), width=2)
                draw.text((x + r + 3, y - r), str(p["n"]), fill=(20, 20, 20))

            legend_y = 10
            for rid, idx in room_color_idx.items():
                room = rooms.get(rid) or {}
                label = room_label_from_tags(room.get("tags")) or (rid or "?")
                draw.rectangle([10, legend_y, 26, legend_y + 16], fill=ROOM_COLORS[idx], outline=(20, 20, 20))
                draw.text((32, legend_y), label, fill=(20, 20, 20))
                legend_y += 20

            floor_label = (floors.get(floor_id) or {}).get("label") or floor_id or "floor"
            fname = f"plan_schematic_{safe_filename(floor_label)}.png" if len(by_floor) > 1 else "plan_schematic.png"
            img.save(os.path.join(ARCHIVE_DIR, fname))
            result[floor_id] = fname
            self.log_msg(f"[план] своя схема этажа «{floor_label}»: {len(pts)} точек → {fname}")
        return result

    def _burn_plan_camera_marks(self, links):
        """Раунд 41 (замечание 3 — позиции камер обязаны быть видны на
        итоговых планах): для каждого план-PNG берём точки из links.
        Пространство координат больше НЕ доверяется на слово: сначала
        точный пересчёт extra.floorplanMeters через viewBox соседнего
        plan_floor_<id>.svg; если метров нет — plan_px «как есть», а при
        выходе за 1.5-кратный размер изображения — единый авто-масштаб
        (план-пространство -> растр); слегка вылезшие точки клампятся к
        краям. Рисуем номерные красные круги. Ничего не выбрасываем
        молча: пропущенные точки попадают в лог с примером значений."""
        import math as _m
        from collections import defaultdict
        self._clean_plans = {}
        by_png = defaultdict(list)
        for rec in links or []:
            pf = rec.get("plan_file")
            if not pf:
                fid = (rec.get("floor") or {}).get("id")
                cand = f"plan_floor_{fid}.png" if fid else None
                if cand and os.path.exists(os.path.join(ARCHIVE_DIR, cand)):
                    pf = cand
            if not pf:
                continue
            px = rec.get("plan_px") or {}
            fm = (rec.get("extra") or {}).get("floorplanMeters") or {}

            def _f(v):
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    return None
                return v if _m.isfinite(v) else None

            x, y = _f(px.get("x")), _f(px.get("y"))
            mx, my = _f(fm.get("x")), _f(fm.get("y"))
            if (x is None or y is None) and (mx is None or my is None):
                continue
            by_png[pf].append((x, y, rec.get("n"), mx, my,
                               bool(rec.get("hidden_on_plan"))))
        if not by_png:
            self.log_msg("[план][камеры] plan_px/floorplanMeters нет ни в одной "
                         "записи links — метки не нанесены")
            return 0
        try:
            from PIL import Image, ImageDraw, ImageFont
        except ImportError:
            self.log_msg("[план][камеры] нет Pillow — позиции на планы не "
                         "нанесены")
            return 0
        done = 0
        for fname, pts in by_png.items():
            path = os.path.join(ARCHIVE_DIR, fname)
            if not os.path.exists(path):
                continue
            try:
                im = Image.open(path)
                # раунд 73: прозрачный фон плана (как у Zillow) не заливаем
                has_alpha = "A" in im.getbands() or "transparency" in im.info
                im = im.convert("RGBA" if has_alpha else "RGB")
                W, H = im.width, im.height
                # viewBox соседнего SVG — для точного пересчёта из метров
                vb = None
                sp = os.path.join(ARCHIVE_DIR,
                                  os.path.splitext(fname)[0] + ".svg")
                if os.path.exists(sp):
                    try:
                        b = self._bake_svg_width_height(sp)
                        if b and b[2] and len(b[2]) == 4:
                            vb = tuple(float(v) for v in b[2])
                    except Exception:
                        vb = None
                # если plan_px систематически крупнее растра — это другое
                # пространство; приводим единым масштабом
                xs = [p[0] for p in pts if p[0] is not None]
                ys = [p[1] for p in pts if p[1] is not None]
                scale = 1.0
                if xs and ys:
                    span = max(max(xs), max(ys), 1.0)
                    lim = float(max(W, H))
                    if span > 1.5 * lim:
                        scale = lim / span
                d = ImageDraw.Draw(im)
                rad = max(7, int(min(im.size) * 0.011))
                try:
                    fnt = ImageFont.load_default(size=int(rad * 1.4))
                except Exception:
                    fnt = None
                show_hidden = False
                try:
                    show_hidden = bool(self.show_hidden_var.get())
                except Exception:
                    show_hidden = False

                def _inside_cnt(seq):
                    return sum(1 for XX, YY in seq
                               if -0.15 * W <= XX <= 1.15 * W and -0.15 * H <= YY <= 1.15 * H)

                # раунд 45: floorplanMeters и plan_px могут быть в РАЗНЫХ
                # пространствах; считаем оба кандидата и выбираем путь,
                # у которого больше точек попало внутрь растра
                cand_m, cand_p = [], []
                for (x, y, n, mx, my, hid) in pts:
                    Xm = Ym = Xp = Yp = None
                    if vb is not None and mx is not None:
                        vx, vy, vw, vh = vb
                        if vw > 0 and vh > 0:
                            Xm = (mx - vx) / vw * W
                            Ym = (my - vy) / vh * H
                    if x is not None:
                        Xp, Yp = x * scale, y * scale
                    cand_m.append((Xm, Ym))
                    cand_p.append((Xp, Yp))
                use_meters = False
                if vb is not None and any(c[0] is not None for c in cand_m):
                    use_meters = _inside_cnt([c for c in cand_m if c[0] is not None]) >= \
                        _inside_cnt([c for c in cand_p if c[0] is not None])
                chosen = cand_m if use_meters else cand_p
                # копия плана БЕЗ номеров камер — для PALACE (index.html): ему не
                # нужно искать и стирать красные кружки, камеры он рисует сам
                try:
                    clean_name = os.path.splitext(fname)[0] + ".clean.png"
                    im.save(os.path.join(ARCHIVE_DIR, clean_name), optimize=False, compress_level=6)
                    self._clean_plans[fname] = clean_name
                except Exception as _e:
                    self.log_msg(f"[план][чистый] {fname}: копия без камер не сохранена — {_e}")
                self.log_msg("[план][камеры] %s: источник координат — %s" % (
                    fname, "floorplanMeters через viewBox" if use_meters
                    else "plan_px (масштаб %.3f)" % scale))
                drawn = skipped = hidden_n = 0
                sample = None
                for (X, Y), (x, y, n, mx, my, hid) in zip(chosen, pts):
                    if X is None or Y is None or not (_m.isfinite(X)
                                                       and _m.isfinite(Y)):
                        skipped += 1
                        if sample is None:
                            sample = (x, y, mx, my)
                        continue
                    X = min(max(X, rad), W - rad)
                    Y = min(max(Y, rad), H - rad)
                    if hid and not show_hidden:
                        hidden_n += 1
                        continue
                    if hid:
                        d.ellipse([X - rad, Y - rad, X + rad, Y + rad],
                                  outline=(255, 140, 0), width=3)
                        if n is not None:
                            try:
                                d.text((X, Y), str(n), fill=(255, 140, 0),
                                       font=fnt, anchor="mm")
                            except Exception:
                                d.text((X - rad, Y - 4), str(n),
                                       fill=(255, 140, 0), font=fnt)
                        drawn += 1
                        continue
                    d.ellipse([X - rad, Y - rad, X + rad, Y + rad],
                              fill=(220, 40, 40), outline=(255, 255, 255),
                              width=2)
                    if n is not None:
                        try:
                            d.text((X, Y), str(n), fill=(255, 255, 255),
                                   font=fnt, anchor="mm")
                        except Exception:
                            d.text((X - rad, Y - 4), str(n),
                                   fill=(255, 255, 255), font=fnt)
                    drawn += 1
                if scale != 1.0:
                    self.log_msg(f"[план][камеры] {fname}: plan_px в чужом "
                                 f"пространстве — приведён масштабом "
                                 f"{scale:.3f}")
                if skipped:
                    self.log_msg(f"[план][камеры] {fname}: пропущено точек: "
                                 f"{skipped}, пример (px.x, px.y, m.x, m.y)="
                                 f"{sample}")
                if hidden_n:
                    self.log_msg(f"[план][камеры] {fname}: скрытых камер не нарисовано: "
                                 f"{hidden_n} (включите «Показать скрытые камеры»)")
                im.save(path)
                done += 1
                self.log_msg(f"[план][камеры] {fname}: нанесено позиций: "
                             f"{drawn}")
            except Exception as e:
                self.log_msg(f"[план][камеры] {fname}: не удалось — {e}")
        return done

    # ---------- общее: сохранение / архив ----------

    def _palace_manifest(self, links):
        """Раунд 74: подсказки для PALACE (index.html) — meta.json → "palace".
        Для каждого растрового плана: размер, копия без номеров камер (clean) и
        готовые подписи комнат в пикселях плана (labels, из SVG этажа). С ними
        index.html не стирает кружки камер, не рендерит SVG в браузере и не
        запускает OCR — план открывается сразу."""
        plans = {}
        pfiles = []
        for rec in links or []:
            pf = rec.get("plan_file") if isinstance(rec, dict) else None
            if pf and pf not in pfiles:
                pfiles.append(pf)
        if not pfiles and os.path.exists(os.path.join(ARCHIVE_DIR, "plan.png")):
            pfiles.append("plan.png")
        try:
            svgs = sorted(f for f in os.listdir(ARCHIVE_DIR) if f.lower().endswith(".svg"))
        except Exception:
            svgs = []
        clean_map = getattr(self, "_clean_plans", {}) or {}
        for pf in pfiles:
            path = os.path.join(ARCHIVE_DIR, pf)
            if not os.path.exists(path) or not re.search(r"\.(png|jpe?g|webp|avif)$", pf, re.I):
                continue
            wh = self._get_image_pixel_size(path)
            if not wh:
                continue
            W, H = wh
            info = {"width": W, "height": H}
            cl = clean_map.get(pf)
            info["clean"] = cl if cl and os.path.exists(os.path.join(ARCHIVE_DIR, cl)) else pf
            stem = os.path.splitext(pf)[0]
            suffix = stem[4:] if stem.lower().startswith("plan") else ""
            for sv in dict.fromkeys([stem + ".svg", "plan_listing" + suffix + ".svg"] + svgs):
                if sv not in svgs:
                    continue
                try:
                    with open(os.path.join(ARCHIVE_DIR, sv), encoding="utf-8", errors="replace") as f:
                        labels = plan_svg_labels(f.read(), W, H)
                except Exception:
                    labels = []
                if labels:
                    info["labels"] = labels
                    info["labels_from"] = sv
                    break
            plans[pf] = info
        return {"format": 1, "generator": "3D Tour Grabber " + GRABBER_VERSION_SHORT, "plans": plans}

    def _finalize(self, links, mapping, meta, base_name=OUTPUT_BASENAME):
        # Раунд 40 (замечание 3): сначала печатаем позиции камер на
        # итоговые планы, потом пишем json/архив.
        try:
            self._burn_plan_camera_marks(links)
        except Exception as e:
            self.log_msg(f"[план][камеры] разметка не удалась: {e}")
        try:
            meta["palace"] = self._palace_manifest(links)
            pl = meta["palace"]["plans"]
            self.log_msg(f"[palace] подсказки для редактора: планов {len(pl)}, "
                         f"подписей {sum(len(v.get('labels') or []) for v in pl.values())}")
        except Exception as e:
            self.log_msg(f"[palace] подсказки для редактора не собраны: {e}")
        try:
            with open(MAPPING_PATH, "w", encoding="utf-8") as f:
                json.dump(mapping, f, ensure_ascii=False, indent=2)
            with open(LINKS_PATH, "w", encoding="utf-8") as f:
                json.dump(links, f, ensure_ascii=False, indent=2)
            with open(META_PATH, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
            self.log_msg(f"[данные] mapping.json / links.json / meta.json сохранены ({len(links)} записей)")
        except Exception as e:
            self.log_msg(f"[данные] ошибка сохранения json: {e}")

        zip_path = next_zip_path(base_name)
        # фото/планы уже сжаты (JPG/AVIF/PNG) — кладём как есть (ZIP_STORED): архив
        # пишется в разы быстрее, а index.html читает их без распаковки deflate
        stored_ext = (".jpg", ".jpeg", ".png", ".avif", ".webp", ".gif", ".mp4", ".webm")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            for fn in sorted(os.listdir(ARCHIVE_DIR)):
                full = os.path.join(ARCHIVE_DIR, fn)
                if os.path.isfile(full):
                    ct = zipfile.ZIP_STORED if fn.lower().endswith(stored_ext) else zipfile.ZIP_DEFLATED
                    zf.write(full, arcname=fn, compress_type=ct)
        self.log_msg(f"АРХИВ: {os.path.abspath(zip_path)}")

        # закрываем файловый хендл журнала перед удалением папки arhive/,
        # чтобы на всех платформах (включая Windows) rmtree не споткнулся
        # об открытый файл debug_log.txt
        with self.log_lock:
            if self._log_fh:
                try:
                    self._log_fh.close()
                except Exception:
                    pass
                self._log_fh = None

        try:
            shutil.rmtree(ARCHIVE_DIR)
            self.log_msg(f"[очистка] временная папка {ARCHIVE_DIR}/ удалена — все данные теперь только в архиве")
        except Exception as e:
            self.log_msg(f"[очистка] не удалось удалить {ARCHIVE_DIR}/: {e}")

        return zip_path


def main():
    root = tk.Tk()
    GrabberApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
