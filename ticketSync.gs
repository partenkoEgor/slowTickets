/*
  Синхронизация таблицы зависших тикетов с новой выгрузкой, с разбивкой
  по Ticket type на 4 отдельных листа, плюс маршрутизация части тикетов
  на дополнительные спец-листы (BT M for TA, API for GEO, PSP for GEO).

  Листы
   - Буфер — один общий лист, сюда вставляется выгрузка целиком, как есть,
     с заголовками в первой строке. Может содержать тикеты любых типов
     вперемешку — скрипт сам раскладывает их по нужным листам, смотря на
     колонку Ticket type (BT M / API / PSP / SMP M).
   - BT M, API, PSP, SMP M — 4 листа Tracking, по одному на тип.
     Структура (заголовки) одинаковая на всех — включая спец-листы ниже:
     Тип платежа, Дата фиксации, Дата создания тикета, Дата входа в статус,
     Processing time, ГЕО, Субагент, Департамент, Ticket ID, User ID,
     Статус зависания, Причина зависания, Актуальный статус, Результат,
     Комментарий.
     Тип платежа — не копия колонки Topic, а её перевод в "Депозит" /
     "Вывод" по словарю CONFIG.paymentTypeMap. Департамент — прямая копия
     колонки Department из выгрузки (CONFIG.fieldMap), заполняется на всех
     листах, включая спец-листы и архивы. В Лог переноса не попадает.
   - BT M for TA, API for GEO, PSP for GEO — спец-листы (см. раздел
     "Спец-маршрутизация" ниже). Тикет уезжает туда вместо обычного
     Tracking-листа, если для него выполняется условие соответствующего
     правила из CONFIG.specialRouting. Перенос двусторонний: как только
     условие перестаёт выполняться, тикет возвращается в обычный Tracking
     при следующей синхронизации. Ручные колонки при переездах
     сохраняются. Фильтр 72 часов к этим листам не применяется. Архивация
     работает так же, как у обычного Tracking: тикет, пропавший из
     выгрузки, чей текущий Статус зависания входит в статус-скоуп этой
     выгрузки, уходит в ОБЩИЙ архив своего типа (Архив BT M / Архив API /
     Архив PSP), а не в отдельный архив; правила ручного переноса
     решённых (см. ниже) к этим листам тоже применяются, перенос идёт
     в тот же общий архив.
   - Архив BT M, Архив API, Архив PSP, Архив SMP M — сюда переносятся
     тикеты соответствующего типа, которые реально вышли из своего
     отслеживаемого статуса, а также тикеты, вручную помеченные командой
     как решённые (см. ниже). Создаются автоматически при первом
     переносе. Тикеты со спец-листов архивируются в тот же архив, что и
     обычные тикеты этого типа.
   - Лог переноса — накопительный журнал тикетов, перенесённых в архив
     вручную (по кнопке "Перенести решённые в архив" или автоматически
     в конце синхронизации). Колонки: Ticket ID, ГЕО, Субагент, Дата
     переноса — департамент в лог намеренно не пишется. Рядом со сводкой
     — живая формула-счётчик общего числа перенесённых тикетов.

  Исключённые статусы (CONFIG.excludedStatuses)
   Строки выгрузки, у которых External Status равен одному из значений
   этого списка (без учёта регистра), отбрасываются в самом начале
   обработки — как будто их в выгрузке вообще не было. Сейчас в списке
   четыре статуса: Individual approval (встречается у API), Approval
   of compensation (встречается у PSP), In progress PS и Transaction
   verification; фильтр применяется ко всем 4 типам одинаково.
   Следствия:
    - новый тикет с таким статусом в Tracking НЕ добавляется;
    - тикет, уже живущий в Tracking и пришедший в выгрузке с таким
      статусом, считается пропавшим из выгрузки: если его текущий
      статус входит в статус-скоуп этой выгрузки — уходит в Архив,
      иначе остаётся в Tracking как есть;
    - строка спец-листа в такой ситуации ведёт себя так же, как
      пропавшая из выгрузки: если её статус входит в статус-скоуп —
      уходит в общий Архив, иначе остаётся на спец-листе;
    - исключённые статусы не участвуют в расчёте статус-скоупа выгрузки.
   В алерте синхронизации появляется счётчик "исключено по статусу: N"
   (показывается, когда N > 0).

  Гео-фильтр по статусам (CONFIG.geoStatusFilter)
   Для отдельных ГЕО можно ограничить набор статусов, при которых тикет
   вообще участвует в синхронизации данного типа. Сейчас настроено одно
   правило: ГЕО Bahrain для типа API. Такие тикеты попадают в Tracking
   и остаются там, только если External Status равен "In progress" или
   "Awaiting response from PS" (без учёта регистра). Строка Буфера с
   этим ГЕО и статусом вне списка отбрасывается в начале обработки типа,
   точно так же, как строки из CONFIG.excludedStatuses выше, со всеми
   теми же следствиями. Правило привязано к типу через поле types
   (сейчас только API), пустой или отсутствующий types означает "для
   всех типов". Список правил можно расширять другими ГЕО без изменения
   логики. НЕ ПУТАТЬ с спец-маршрутизацией "geoWhitelist" ниже: это два
   независимых механизма на одной и той же оси "ГЕО", но с разным
   смыслом — этот отбрасывает строки совсем (тикет не появляется нигде),
   а geoWhitelist-маршрутизация просто выбирает, на какой лист тикет
   попадёт (он остаётся полностью отслеживаемым). В алерте синхронизации
   появляется счётчик "исключено по гео-фильтру: N" (показывается,
   когда N > 0).

  Спец-маршрутизация (CONFIG.specialRouting)
   Список правил, каждое — для одного конкретного типа тикета (не более
   одного правила на тип). Решение о том, уезжает ли строка Буфера на
   спец-лист вместо обычного Tracking, принимается ПРЯМО ПО СТРОКЕ
   БУФЕРА, до записи в Tracking, и заново пересчитывается на каждой
   синхронизации (поэтому перенос двусторонний). Два вида условия (поле
   kind):
    - kind: 'statusComment' — тикет уходит на спец-лист, если его
      External Status в Буфере равен любому значению из statusAnyOf
      (без учёта регистра) И его Internal comment в Буфере содержит
      подстроку commentContains (без учёта регистра). Сейчас так
      настроен только BT M → "BT M for TA":
        - ВНИМАНИЕ: в выгрузке буква "М" в "(М)" — КИРИЛЛИЧЕСКАЯ, внешне
          неотличима от латинской. В statusAnyOf оба варианта + статус
          без скобок, чтобы не зависеть от того, как именно система
          отдаст значение.
    - kind: 'geoWhitelist' — тикет уходит на спец-лист, если его ГЕО
      (колонка geoHeaderStaging в Буфере) НЕ входит в список knownGeos
      (без учёта регистра и пробелов по краям) — то есть это "чужой"
      для компании ГЕО. Сейчас так настроены API → "API for GEO" и
      PSP → "PSP for GEO", со списком из ~40 стран (см. CONFIG.knownGeos
      / константу KNOWN_GEOS выше CONFIG — там же предупреждение про
      рискованное написание отдельных стран).
   Лист создаётся автоматически, структура та же, что у Tracking, и он
   точно так же перезаписывается целиком при КАЖДОЙ синхронизации типа
   (даже если пуст) — иначе тикеты, вернувшиеся в обычный Tracking или
   уехавшие в Архив, останутся продублированными на спец-листе.
   Отличия спец-листов от обычного Tracking:
    - фильтр minProcessingHours к строкам спец-листа НЕ применяется;
    - архивация по статус-скоупу работает ТАК ЖЕ, как у Tracking:
      тикет, пропавший из выгрузки, чей текущий Статус зависания
      входит в статус-скоуп, уходит в ОБЩИЙ архив типа;
    - правила ручного переноса решённых (CONFIG.manualArchive) к
      спец-листу тоже применяются, перенос — в тот же общий архив.

  Ручной перенос тикетов в архив
   Тикет из любого Tracking-листа (и любого спец-листа) переносится в
   свой Архив, если совпали ВСЕ условия хотя бы одного правила из
   CONFIG.manualArchive.rules (правила проверяются по порядку,
   применяется первое совпавшее). Сейчас правил три:
    1) Актуальный статус = "В работе" И Результат = "Решено" — решили
       мы сами: тикет уходит в Архив И записывается в Лог переноса
       (учитывается счётчиком). Только эта комбинация попадает в подсчёт.
    2) Результат = "Решено" при любом другом статусе (Отправлен КМ /
       Team A / Team B / L1 / агенту) — решено, но не нами: в Архив
       БЕЗ записи в лог и без учёта в счётчике.
    3) Результат = "Закрыт пользователем" — в Архив БЕЗ подсчёта.
   Результат = "В работе у профильной команды" или пустой — не финал,
   тикет остаётся в Tracking.
   Правила и поля для лога вынесены в конфиг, чтобы их было легко
   поменять без переписывания логики. Проверка выполняется отдельной
   функцией archiveManuallyResolvedTickets() — её можно запустить кнопкой
   в меню, и она же автоматически прогоняется в конце syncTickets() для
   каждого успешно синхронизированного типа (чтобы не забыть сделать
   это руками).

  Надёжность данных (защита от дыр в Дате фиксации и съехавших строк)
   - Перед чтением КАЖДОГО листа (Буфер, Tracking, спец-листы) скрипт
     сбрасывает фильтрацию — очищает условия базового фильтра (сам
     фильтр остаётся, просто в состоянии "показать всё") и раскрывает
     скрытые строки и столбцы — см. resetSheetFilters(). Это защищает от
     главного источника проблем: ручной вставки данных на отфильтрованном
     листе, когда значения ложатся в скрытые строки и разъезжаются по
     чужим тикетам.
   - Проверка структуры ДО любых изменений. Раньше отсутствие колонки
     просто молча пропускалось при заполнении (поле оставалось пустым);
     теперь скрипт сначала сверяет заголовки и падает с понятной
     ошибкой, перечисляя, чего не хватает:
        • Буфер — все колонки-источники (assertStagingHeaders): если хоть
          одной нет, синхронизация не начинается вообще, Буфер не
          очищается;
        • Tracking-лист — все обязательные колонки (assertTrackingHeaders):
          падает только этот тип, остальные обрабатываются как обычно;
        • Спец-лист — заголовки должны ПОБАЙТОВО совпадать с заголовками
          основного Tracking-листа этого типа (проверяется прямо внутри
          syncOneType в момент чтения спец-листа, отдельной функцией не
          вынесено — иначе строки при чтении поедут по колонкам);
        • Архив и Лог переноса — заголовки должны совпадать с теми, что
          пишет скрипт (assertArchiveHeaders / assertManualArchiveLogHeaders).
          Проверка идёт ДО записи, чтобы не дописать строки со сдвигом на
          колонку.
     Чаще всего причина промаха — лишний пробел или латинская буква-
     двойник в заголовке; поможет пункт меню "Диагностика колонок".
   - Страховочный backfill: если у строки, остающейся в Tracking или на
     спец-листе, Дата фиксации оказалась пустой (тикет добавили руками,
     дату стёрли и т.п.) — при синхронизации она заполняется текущей
     датой. Уже заполненные даты НЕ перезаписываются: правило "дата
     ставится один раз при первом добавлении" сохраняется.
   - Пункт меню "Диагностика колонок" (diagnoseFirstSeen) — для разбора
     проблем: проходит по Буферу, всем Tracking-листам, всем спец-листам,
     архивам и Логу переноса и показывает, каких обязательных колонок
     не хватает (с посимвольными hex-кодами похожего заголовка для ловли
     гомоглифов и невидимых пробелов), а по Tracking и спец-листам
     дополнительно считает строки с пустой Датой фиксации. Пишет и в
     алерт, и в Logger (работает и из редактора).

  Логика для КАЖДОГО типа выполняется независимо (на своей паре
  staging-подмножество / свой Tracking-лист), но по одной схеме:

   1. Из Буфера берём только строки с нужным Ticket type, отбрасываем
      строки со статусами из CONFIG.excludedStatuses и строки, не
      прошедшие гео-фильтр по статусам (CONFIG.geoStatusFilter), среди
      оставшихся убираем дубли по Ticket ID.
   2. Определяем, какие статусы присутствуют среди ЭТИХ строк (статус-
      скоуп для этого конкретного типа в этой выгрузке) — сюда входят
      строки, которые в итоге попадут и на обычный Tracking, и на
      спец-лист.
   3. Тикет в Tracking (или на спец-листе), который нашёлся среди этих
      строк (по Ticket ID, независимо от того, какой статус был раньше)
      — обновляется (статус, Дата входа в статус и т.д.), пересчитывается
      Processing time, и заново решается, на каком листе он должен жить
      (обычный Tracking или спец-лист — по CONFIG.specialRouting).
   4. Тикет в Tracking (или на спец-листе), который НЕ нашёлся, но его
      текущий статус входит в статус-скоуп этой выгрузки — переносится
      в общий Архив своего типа.
   5. Тикет, чей статус не входит в статус-скоуп — не трогается (просто
      пересчитывается Processing time).
   6. Новые тикеты этого типа, которых раньше не было в Tracking —
      добавляются (на обычный Tracking или сразу на спец-лист, по тому
      же правилу). Дата фиксации = сегодня.
   7. Фильтр minProcessingHours применяется ТОЛЬКО к строкам, идущим на
      обычный Tracking-лист: если Processing time получилось меньше
      minProcessingHours, строка в Tracking не остаётся (и в Архив не
      уходит). К строкам спец-листа этот фильтр не применяется никогда.

  Буфер целиком очищается только если ВСЕ 4 типа обработались без ошибок
  (например, если забыли создать один из листов Tracking — Буфер не
  тронем, чтобы не потерять данные; почините лист и запустите заново).
*/

// Список ГЕО, с которыми компания работает — используется правилами
// spec-маршрутизации kind:'geoWhitelist' (API, PSP) ниже в CONFIG. Строка
// Буфера уезжает на спец-лист типа, если её ГЕО НЕ входит в этот список.
//
// ВНИМАНИЕ: значения ниже — предположительное написание на английском,
// как обычно называются страны в подобных выгрузках. Названия стран, у
// которых возможны варианты написания (ОАЭ, Кыргызстан, Турция, Южный
// Судан/Судан, Папуа — Новая Гвинея, Доминиканская Республика), стоит
// сверить с реальным значением в колонке Country при первом запуске —
// быстрее всего через "Диагностика колонок" или просто посмотрев, что
// реально приходит, и поправить строку(и) списка.
const KNOWN_GEOS = [
  'Azerbaijan',            // Азербайджан
  'Algeria',                // Алжир
  'Afghanistan',             // Афганистан
  'Bahrain',                 // Бахрейн
  'Bolivia',                 // Боливия
  'Haiti',                   // Гаити
  'Guatemala',                // Гватемала
  'Honduras',                 // Гондурас
  'Djibouti',                  // Джибути
  'Dominican Republic',         // Доминиканская Республика
  'Egypt',                       // Египет
  'Jordan',                       // Иордания
  'Iraq',                          // Ирак
  'Iran',                           // Иран
  'Yemen',                           // Йемен
  'Canada',                           // Канада
  'Qatar',                             // Катар
  'Costa Rica',                         // Коста Рика
  'Kuwait',                              // Кувейт
  'Kyrgyzstan',                           // Кыргызстан
  'Lebanon',                               // Ливан
  'Libya',                                  // Ливия
  'Mauritania',                              // Мавритания
  'Morocco',                                  // Марокко
  'Nicaragua',                                 // Никарагуа
  'United Arab Emirates',                       // ОАЭ
  'Oman',                                        // Оман
  'Palestine',                                    // Палестина
  'Panama',                                        // Панама
  'Papua New Guinea',                               // Папуа — Новая Гвинея
  'Paraguay',                                        // Парагвай
  'Saudi Arabia',                                     // Саудовская Аравия
  'Syria',                                             // Сирия
  'Somalia',                                            // Сомали
  'Taiwan',                                              // Тайвань
  'Tunisia',                                              // Тунис
  'Turkey',                                                // Турция
  'South Sudan',                                            // Южный Судан
  'Sudan',                                                   // Судан
  'Jamaica',                                                  // Ямайка
];

const CONFIG = {
  stagingSheetName: 'Буфер',
  ticketTypeHeaderStaging: 'Ticket type',

  idHeaderTracking: 'Ticket ID',
  idHeaderStaging: 'Ticket ID',

  statusHeaderTracking: 'Статус зависания',

  // tracking-колонка -> staging-колонка (выгрузка). Одинаковый маппинг для всех 4 типов.
  // Тип платежа сюда не входит — она заполняется отдельно, через paymentTypeMap ниже.
  fieldMap: {
    'Дата создания тикета': 'Date created',
    'Дата входа в статус': 'Processing date',
    'ГЕО': 'Country',
    'Субагент': 'Subagent',
    'Департамент': 'Department',
    'User ID': 'User ID',
    'Статус зависания': 'External Status',
    'Комментарий': 'Internal comment',
  },

  // Тип платежа в Tracking не копируется из выгрузки дословно, а
  // определяется по колонке Topic: депозитные темы -> "Депозит",
  // темы вывода -> "Вывод". Если придёт незнакомое значение Topic —
  // в ячейку попадёт исходный текст как есть (чтобы аномалия была видна).
  paymentTypeHeader: 'Тип платежа',
  paymentTypeSourceHeader: 'Topic',
  paymentTypeMap: {
    // Старые значения Topic оставлены на случай, если где-то ещё встретятся.
    'Unsuccessful deposit': 'Депозит',
    'Deposit error': 'Депозит',
    "I didn't receive my withdrawal": 'Вывод',
    'Error while withdrawing funds': 'Вывод',
    // Новые значения Topic (актуально с августа 2026).
    'Deposit not received': 'Депозит',
    'Error while depositing funds': 'Депозит',
    'Withdrawal not received': 'Вывод',
  },

  firstSeenHeader: 'Дата фиксации',
  statusEntryDateHeader: 'Дата входа в статус',
  processingTimeHeader: 'Processing time',

  minProcessingHours: 72,

  // Статусы выгрузки, тикеты с которыми в таблицу не попадают ВООБЩЕ —
  // строки Буфера с таким External Status отбрасываются в самом начале
  // обработки типа, как будто их в выгрузке не было. Сравнение без учёта
  // регистра, пробелы по краям игнорируются. Individual approval
  // встречается у API, Approval of compensation — у PSP, но фильтр
  // применяется ко всем 4 типам одинаково.
  excludedStatuses: [
    'Individual approval',
    'Approval of compensation',
    'In progress PS',
    'Transaction verification',
  ],

  // Гео-фильтр по статусам: тикеты с указанным ГЕО участвуют в
  // синхронизации, только если их External Status входит в
  // allowedStatuses (без учёта регистра). Остальные статусы для этого
  // ГЕО отбрасываются в начале обработки типа, так же как статусы из
  // CONFIG.excludedStatuses выше. Поле types ограничивает правило
  // конкретными значениями Ticket type, пустой список или отсутствие
  // поля означает "для всех типов". Сейчас правило одно: Bahrain для API.
  geoStatusFilter: {
    geoHeaderStaging: 'Country',
    rules: [
      {
        geo: 'Bahrain',
        types: ['API'],
        allowedStatuses: ['In progress', 'Awaiting response from PS'],
      },
    ],
  },

  // Правила ручного переноса тикетов в архив (см. шапку файла и
  // archiveManuallyResolvedTickets()). Тикет переносится, если совпали
  // ВСЕ условия хотя бы одного правила. Правила проверяются ПО ПОРЯДКУ,
  // применяется первое совпавшее — поэтому "В работе + Решено" стоит
  // первым и перехватывает подсчёт, а остальные "Решено" проваливаются
  // во второе правило без подсчёта. Флаг log определяет, попадает ли
  // тикет в Лог переноса (счётчик сделанного нами).
  manualArchive: {
    rules: [
      {
        conditions: [
          { header: 'Актуальный статус', value: 'В работе' },
          { header: 'Результат', value: 'Решено' },
        ],
        log: true,
      },
      {
        conditions: [
          { header: 'Результат', value: 'Решено' },
        ],
        log: false,
      },
      {
        conditions: [
          { header: 'Результат', value: 'Закрыт пользователем' },
        ],
        log: false,
      },
    ],
    logSheetName: 'Лог переноса',
    // Поля, которые попадают в Лог переноса (в этом порядке).
    // К ним всегда добавляется колонка "Дата переноса" последней.
    logFields: [
      { logHeader: 'Ticket ID', trackingHeader: 'Ticket ID' },
      { logHeader: 'ГЕО', trackingHeader: 'ГЕО' },
      { logHeader: 'Субагент', trackingHeader: 'Субагент' },
    ],
  },

  // Спец-маршрутизация: не более одного правила на тип. Решение
  // принимается ПРЯМО ПО СТРОКЕ БУФЕРА, до записи в Tracking. См.
  // раздел "Спец-маршрутизация" в шапке файла за подробным описанием
  // обоих видов условия (kind).
  specialRouting: [
    {
      typeValue: 'BT M',
      sheetName: 'BT M for TA',
      kind: 'statusComment',
      statusHeaderStaging: 'External Status',
      // ВНИМАНИЕ: в выгрузке буква "М" в "(М)" — КИРИЛЛИЧЕСКАЯ, внешне
      // неотличима от латинской. В списке оба варианта + статус без
      // скобок, чтобы не зависеть от того, как именно система отдаст
      // значение.
      statusAnyOf: [
        'In progress (М)', // кириллическая М — так в реальной выгрузке
        'In progress (M)', // латинская M — на всякий случай
        'In progress',
      ],
      commentHeaderStaging: 'Internal comment',
      commentContains: 'for TA',
    },
    {
      typeValue: 'API',
      sheetName: 'API for GEO',
      kind: 'geoWhitelist',
      geoHeaderStaging: 'Country',
      knownGeos: KNOWN_GEOS,
    },
    {
      typeValue: 'PSP',
      sheetName: 'PSP for GEO',
      kind: 'geoWhitelist',
      geoHeaderStaging: 'Country',
      knownGeos: KNOWN_GEOS,
    },
  ],

  types: [
    { value: 'BT M',  trackingSheet: 'BT M',  archiveSheet: 'Архив BT M' },
    { value: 'API',   trackingSheet: 'API',   archiveSheet: 'Архив API' },
    { value: 'PSP',   trackingSheet: 'PSP',   archiveSheet: 'Архив PSP' },
    { value: 'SMP M', trackingSheet: 'SMP M', archiveSheet: 'Архив SMP M' },
  ],

  clearStagingAfterSync: true,
};

// Быстрый доступ "тип -> его спец-лист" (undefined, если у типа нет
// спец-листа — сейчас так у SMP M). Строится один раз из CONFIG.specialRouting.
const SPECIAL_ROUTING_BY_TYPE = new Map(CONFIG.specialRouting.map(l => [l.typeValue, l]));

function syncTickets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stagingSheet = ss.getSheetByName(CONFIG.stagingSheetName);
  if (!stagingSheet) {
    throw new Error('Лист "' + CONFIG.stagingSheetName + '" не найден.');
  }

  // Сбрасываем фильтрацию, чтобы читать полный набор строк выгрузки.
  resetSheetFilters(stagingSheet);

  const stagingData = stagingSheet.getDataRange().getValues();
  if (stagingData.length === 0) {
    throw new Error('Буфер пуст.');
  }

  const sHeaders = stagingData[0];

  // Сверяем заголовки выгрузки ДО обработки: не хватает колонки-источника —
  // синхронизация вообще не начинается и Буфер не очищается. Раньше
  // отсутствие такой колонки просто оставляло поле пустым во всех строках.
  assertStagingHeaders(sHeaders);

  const sIdCol = sHeaders.indexOf(CONFIG.idHeaderStaging);
  const sTypeCol = sHeaders.indexOf(CONFIG.ticketTypeHeaderStaging);

  const allStagingRows = stagingData.slice(1);
  const summaries = [];

  CONFIG.types.forEach(typeConfig => {
    const rowsOfType = allStagingRows.filter(r => String(r[sTypeCol]).trim() === typeConfig.value);
    try {
      const summary = syncOneType(ss, typeConfig, sHeaders, rowsOfType, sIdCol);
      try {
        const manualSummary = archiveManuallyResolvedForType(ss, typeConfig);
        summary.archivedManually = manualSummary.archived;
        summary.archivedLogged = manualSummary.archivedLogged;
        summary.archivedFromLane = manualSummary.archivedFromLane;
        summary.headerLikeRowsRemoved =
          (summary.headerLikeRowsRemoved || 0) + (manualSummary.garbageRemoved || 0);
      } catch (e2) {
        summary.archivedManually = 0;
        summary.manualArchiveError = e2.message;
      }
      summaries.push(summary);
    } catch (e) {
      summaries.push({ typeValue: typeConfig.value, error: e.message });
    }
  });

  const hadError = summaries.some(s => s.error);

  // Буфер чистим только если все 4 типа прошли без ошибок —
  // иначе можно потерять необработанные строки проблемного типа.
  if (CONFIG.clearStagingAfterSync && !hadError && stagingData.length > 1) {
    stagingSheet.getRange(2, 1, stagingData.length - 1, sHeaders.length).clearContent();
  }

  const lines = summaries.map(s => {
    if (s.error) return s.typeValue + ': ОШИБКА: ' + s.error;
    let line = s.typeValue + ': добавлено ' + s.added + ', обновлено ' + s.updated +
      ', в архив ' + s.removedGoneFromStatus +
      (s.removedFromLane ? ' (из "' + s.laneSheetName + '" ' + s.removedFromLane + ')' : '') +
      ', скрыто ' + CONFIG.minProcessingHours + 'ч: ' + s.droppedTooFresh +
      ', не тронуто ' + s.untouched + ', итого ' + s.total +
      ', решено→архив ' + (s.archivedManually || 0) +
      ' (в лог ' + (s.archivedLogged || 0) + ', без подсчёта ' +
      ((s.archivedManually || 0) - (s.archivedLogged || 0)) +
      (s.archivedFromLane ? ', из "' + s.laneSheetName + '" ' + s.archivedFromLane : '') + ')';
    if (s.excludedByStatus) {
      line += ', исключено по статусу: ' + s.excludedByStatus;
    }
    if (s.excludedByGeoStatus) {
      line += ', исключено по гео-фильтру: ' + s.excludedByGeoStatus;
    }
    if (s.firstSeenBackfilled) {
      line += ', дозаполнено дат фиксации: ' + s.firstSeenBackfilled;
    }
    if (s.headerLikeRowsRemoved) {
      line += ', удалено строк-дублей заголовка: ' + s.headerLikeRowsRemoved;
    }
    if (s.laneTotal !== null && s.laneTotal !== undefined) {
      line += ', "' + s.laneSheetName + '": ' + s.laneTotal;
    }
    if (s.manualArchiveError) {
      line += ' (ОШИБКА переноса решённых: ' + s.manualArchiveError + ')';
    }
    return line;
  });

  if (hadError) {
    lines.push('');
    lines.push('Буфер НЕ очищен из-за ошибок выше. Почините лист(ы) и запустите синхронизацию ещё раз.');
  }

  SpreadsheetApp.getUi().alert('Синхронизация завершена.\n\n' + lines.join('\n'));
}

/*
  Строит функцию-предикат "принадлежит ли эта строка Буфера спец-листу"
  для одного правила CONFIG.specialRouting, один раз на тип (а не на
  каждую строку) — сразу вычисляет нужные колонки Буфера и падает с
  понятной ошибкой, если их нет.
*/
function buildLaneMatcher(laneConfig, sHeaders) {
  if (!laneConfig) return null;

  if (laneConfig.kind === 'statusComment') {
    const sStatusCol = sHeaders.indexOf(laneConfig.statusHeaderStaging);
    const sCommentCol = sHeaders.indexOf(laneConfig.commentHeaderStaging);
    if (sStatusCol === -1) {
      throw new Error('Колонка "' + laneConfig.statusHeaderStaging +
        '" не найдена в Буфере — маршрутизация на лист "' + laneConfig.sheetName + '" невозможна.');
    }
    if (sCommentCol === -1) {
      throw new Error('Колонка "' + laneConfig.commentHeaderStaging +
        '" не найдена в Буфере — маршрутизация на лист "' + laneConfig.sheetName + '" невозможна.');
    }
    const statusesLower = laneConfig.statusAnyOf.map(s => String(s).trim().toLowerCase());
    const commentContainsLower = String(laneConfig.commentContains).toLowerCase();
    return function (stagingRow) {
      const status = String(stagingRow[sStatusCol]).trim().toLowerCase();
      if (statusesLower.indexOf(status) === -1) return false;
      const comment = String(stagingRow[sCommentCol]).toLowerCase();
      return comment.indexOf(commentContainsLower) !== -1;
    };
  }

  if (laneConfig.kind === 'geoWhitelist') {
    const sGeoCol = sHeaders.indexOf(laneConfig.geoHeaderStaging);
    if (sGeoCol === -1) {
      throw new Error('Колонка "' + laneConfig.geoHeaderStaging +
        '" не найдена в Буфере — маршрутизация на лист "' + laneConfig.sheetName + '" невозможна.');
    }
    const knownGeosLower = laneConfig.knownGeos.map(g => String(g).trim().toLowerCase());
    return function (stagingRow) {
      const geo = String(stagingRow[sGeoCol]).trim().toLowerCase();
      return knownGeosLower.indexOf(geo) === -1;
    };
  }

  throw new Error('Неизвестный kind в specialRouting: "' + laneConfig.kind + '".');
}

/*
  Синхронизирует один тип тикетов: подмножество строк Буфера этого типа
  против своего листа Tracking, своего спец-листа (если есть в
  CONFIG.specialRouting) и своего листа Архива.
*/
function syncOneType(ss, typeConfig, sHeaders, stagingRowsRaw, sIdCol) {
  const trackingSheet = ss.getSheetByName(typeConfig.trackingSheet);
  if (!trackingSheet) {
    throw new Error('Лист "' + typeConfig.trackingSheet + '" не найден. Создайте его с теми же заголовками, что и в остальных Tracking-листах.');
  }

  // Сбрасываем фильтрацию до чтения: перезапись листа при активном
  // фильтре и правки на отфильтрованном листе — источник съехавших строк.
  resetSheetFilters(trackingSheet);

  const trackingData = trackingSheet.getDataRange().getValues();
  if (trackingData.length === 0) {
    throw new Error('Лист "' + typeConfig.trackingSheet + '" пуст — нужна хотя бы строка заголовков.');
  }
  const tHeaders = trackingData[0];

  // Сверяем структуру ДО любых изменений: все обязательные колонки на
  // месте в самом Tracking-листе, и заголовки архива совпадают с ними
  // (иначе архивные строки лягут со сдвигом на колонку).
  assertTrackingHeaders(typeConfig.trackingSheet, tHeaders);
  assertArchiveHeaders(ss, typeConfig.archiveSheet, tHeaders);
  assertManualArchiveLogHeaders(ss);

  const tIdCol = tHeaders.indexOf(CONFIG.idHeaderTracking);
  const tFirstSeenCol = tHeaders.indexOf(CONFIG.firstSeenHeader);
  const tStatusEntryCol = tHeaders.indexOf(CONFIG.statusEntryDateHeader);
  const tProcCol = tHeaders.indexOf(CONFIG.processingTimeHeader);
  const tStatusCol = tHeaders.indexOf(CONFIG.statusHeaderTracking);
  const sStatusCol = sHeaders.indexOf(CONFIG.fieldMap[CONFIG.statusHeaderTracking]);

  // --- Отсев исключённых статусов (CONFIG.excludedStatuses) ---
  // Делается ДО дедупа и до расчёта статус-скоупа: строка с таким
  // статусом для синхронизации просто не существует. Сравнение без
  // учёта регистра.
  let excludedByStatus = 0;
  let stagingRowsAfterExclusion = stagingRowsRaw;
  const excludedStatusesLower = (CONFIG.excludedStatuses || [])
    .map(s => String(s).trim().toLowerCase());
  if (excludedStatusesLower.length > 0) {
    if (sStatusCol === -1) {
      throw new Error('Колонка "' + CONFIG.fieldMap[CONFIG.statusHeaderTracking] +
        '" не найдена в Буфере — фильтр исключённых статусов ' +
        '(CONFIG.excludedStatuses) применить невозможно.');
    }
    stagingRowsAfterExclusion = stagingRowsRaw.filter(row => {
      const status = String(row[sStatusCol]).trim().toLowerCase();
      if (excludedStatusesLower.indexOf(status) !== -1) {
        excludedByStatus++;
        return false;
      }
      return true;
    });
  }

  // --- Гео-фильтр по статусам (CONFIG.geoStatusFilter) ---
  // Для строк с ГЕО из правила в синхронизации участвуют только
  // перечисленные статусы, остальные отбрасываются так же, как
  // исключённые статусы выше, до дедупа и до расчёта статус-скоупа.
  let excludedByGeoStatus = 0;
  const geoFilterRules = ((CONFIG.geoStatusFilter && CONFIG.geoStatusFilter.rules) || [])
    .filter(r => !r.types || r.types.length === 0 || r.types.indexOf(typeConfig.value) !== -1);
  if (geoFilterRules.length > 0) {
    const sGeoFilterCol = sHeaders.indexOf(CONFIG.geoStatusFilter.geoHeaderStaging);
    if (sGeoFilterCol === -1) {
      throw new Error('Колонка "' + CONFIG.geoStatusFilter.geoHeaderStaging +
        '" не найдена в Буфере, гео-фильтр по статусам применить невозможно.');
    }
    if (sStatusCol === -1) {
      throw new Error('Колонка "' + CONFIG.fieldMap[CONFIG.statusHeaderTracking] +
        '" не найдена в Буфере, гео-фильтр по статусам применить невозможно.');
    }
    stagingRowsAfterExclusion = stagingRowsAfterExclusion.filter(row => {
      const geo = String(row[sGeoFilterCol]).trim().toLowerCase();
      const rule = geoFilterRules.find(r => String(r.geo).trim().toLowerCase() === geo);
      if (!rule) return true;
      const status = String(row[sStatusCol]).trim().toLowerCase();
      const allowedLower = rule.allowedStatuses.map(s => String(s).trim().toLowerCase());
      if (allowedLower.indexOf(status) === -1) {
        excludedByGeoStatus++;
        return false;
      }
      return true;
    });
  }

  // Дедуп строк этого типа по Ticket ID (оставляем первое вхождение)
  const stagingIds = new Set();
  const stagingRows = [];
  stagingRowsAfterExclusion.forEach(row => {
    const id = String(row[sIdCol]).trim();
    if (!id || stagingIds.has(id)) return;
    stagingIds.add(id);
    stagingRows.push(row);
  });
  const stagingRowById = new Map(stagingRows.map(r => [String(r[sIdCol]).trim(), r]));

  // Статусы, которые покрывает эта выгрузка для этого типа (включая
  // строки, которые в итоге уедут на спец-лист).
  const stagingStatusScope = new Set();
  if (sStatusCol !== -1) {
    stagingRows.forEach(r => {
      const v = String(r[sStatusCol]).trim();
      if (v) stagingStatusScope.add(v);
    });
  }

  // Строки-мусор: кто-то случайно скопировал и вставил шапку таблицы как
  // обычную строку данных (см. looksLikeHeaderRow ниже). У такой строки
  // Ticket ID = буквально "Ticket ID", статус никогда не совпадёт ни с
  // одним реальным статусом — без этой проверки она осталась бы в
  // Tracking навсегда, каждый раз просто переписываясь как есть.
  let headerLikeRowsRemoved = 0;

  const trackingRowsById = new Map();
  for (let i = 1; i < trackingData.length; i++) {
    if (looksLikeHeaderRow(trackingData[i], tHeaders)) {
      headerLikeRowsRemoved++;
      continue;
    }
    const id = String(trackingData[i][tIdCol]).trim();
    if (id) trackingRowsById.set(id, trackingData[i]);
  }

  // --- Спец-маршрутизация (CONFIG.specialRouting, не более 1 правила на тип) ---
  const laneConfig = SPECIAL_ROUTING_BY_TYPE.get(typeConfig.value) || null;
  const matchesLane = laneConfig ? buildLaneMatcher(laneConfig, sHeaders) : null;
  let laneSheet = null;
  const laneOriginIds = new Set(); // ID строк, прочитанных со спец-листа

  if (laneConfig) {
    laneSheet = ss.getSheetByName(laneConfig.sheetName);
    if (laneSheet) {
      resetSheetFilters(laneSheet);
      const laneData = laneSheet.getDataRange().getValues();
      // Лист без данных (создан вручную пустым) — просто считаем его пустым,
      // заголовки запишутся при выгрузке результата ниже.
      const laneIsEmpty = laneData.length === 0 ||
        (laneData.length === 1 && laneData[0].every(c => String(c).trim() === ''));
      if (!laneIsEmpty) {
        // Структура спец-листа обязана совпадать с Tracking, иначе строки
        // при чтении поедут по колонкам — лучше упасть с понятной ошибкой.
        if (laneData[0].join('') !== tHeaders.join('')) {
          throw new Error('Заголовки листа "' + laneConfig.sheetName +
            '" не совпадают с заголовками "' + typeConfig.trackingSheet +
            '". Приведите их к одинаковому виду (или очистите лист "' +
            laneConfig.sheetName + '" полностью — он заполнится сам).');
        }
        for (let i = 1; i < laneData.length; i++) {
          if (looksLikeHeaderRow(laneData[i], tHeaders)) {
            headerLikeRowsRemoved++;
            continue;
          }
          const id = String(laneData[i][tIdCol]).trim();
          // Если один и тот же ID вдруг оказался и в Tracking, и на спец-листе —
          // приоритет у строки из Tracking (не перетираем её).
          if (id && !trackingRowsById.has(id)) {
            trackingRowsById.set(id, laneData[i]);
            laneOriginIds.add(id);
          }
        }
      }
    }
  }

  const now = new Date();

  const tPaymentTypeCol = tHeaders.indexOf(CONFIG.paymentTypeHeader);
  const sTopicCol = sHeaders.indexOf(CONFIG.paymentTypeSourceHeader);

  function applyFieldMap(row, stagingRow) {
    Object.keys(CONFIG.fieldMap).forEach(tHeader => {
      const sHeader = CONFIG.fieldMap[tHeader];
      const tCol = tHeaders.indexOf(tHeader);
      const sCol = sHeaders.indexOf(sHeader);
      if (tCol !== -1 && sCol !== -1) row[tCol] = stagingRow[sCol];
    });

    if (tPaymentTypeCol !== -1 && sTopicCol !== -1) {
      const topicValue = String(stagingRow[sTopicCol]).trim();
      row[tPaymentTypeCol] = CONFIG.paymentTypeMap[topicValue] || topicValue;
    }
  }

  function toDate(value) {
    if (value instanceof Date) return value;
    if (!value) return null;
    const parsed = new Date(String(value).trim().replace(' ', 'T'));
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function setProcessingTime(row) {
    if (tProcCol === -1) return null;
    const statusEntry = toDate(row[tStatusEntryCol]);
    if (!statusEntry) return null;
    const hours = (now - statusEntry) / (1000 * 60 * 60);
    const rounded = Math.round(hours * 100) / 100;
    row[tProcCol] = rounded;
    return rounded;
  }

  // Страховка: пустая Дата фиксации у строки, остающейся в Tracking/на
  // спец-листе (тикет добавили руками, дату случайно стёрли и т.п.) —
  // заполняем текущей датой. Уже заполненные даты НЕ трогаем: правило
  // ставится один раз при первом добавлении и сохраняется.
  let firstSeenBackfilled = 0;
  function ensureFirstSeen(row) {
    if (tFirstSeenCol === -1) return;
    if (String(row[tFirstSeenCol]).trim() === '') {
      row[tFirstSeenCol] = now;
      firstSeenBackfilled++;
    }
  }

  const result = [];
  const laneResult = [];
  const toArchive = [];
  let removedGoneFromStatus = 0;
  let removedFromLane = 0;
  let droppedTooFresh = 0;
  let updated = 0;
  let added = 0;
  let untouched = 0;

  trackingRowsById.forEach((row, id) => {
    if (stagingIds.has(id)) {
      const stagingRow = stagingRowById.get(id);
      applyFieldMap(row, stagingRow);
      setProcessingTime(row);
      ensureFirstSeen(row);
      // Условие спец-маршрутизации проверяем по строке БУФЕРА — свежие
      // External Status / Internal comment / ГЕО из выгрузки решают,
      // куда едет тикет.
      if (matchesLane && matchesLane(stagingRow)) {
        laneResult.push(row);
        updated++;
        return;
      }
      if (tProcCol !== -1) {
        const hours = row[tProcCol];
        if (typeof hours === 'number' && hours < CONFIG.minProcessingHours) {
          droppedTooFresh++;
          return;
        }
      }
      result.push(row);
      updated++;
      return;
    }

    // Тикета нет в выгрузке. Строки, живущие на спец-листе, архивируются
    // по тому же правилу статус-скоупа, что и обычный Tracking: если
    // текущий Статус зависания входит в скоуп этой выгрузки — тикет
    // вышел из отслеживаемого статуса и уходит в общий Архив типа.
    // Иначе остаётся на спец-листе (фильтр 72 часов к нему не
    // применяется).
    if (laneOriginIds.has(id)) {
      const laneCurrentStatus = tStatusCol !== -1 ? String(row[tStatusCol]).trim() : '';
      if (stagingStatusScope.size > 0 && stagingStatusScope.has(laneCurrentStatus)) {
        toArchive.push(row);
        removedGoneFromStatus++;
        removedFromLane++;
        return;
      }
      setProcessingTime(row);
      ensureFirstSeen(row);
      laneResult.push(row);
      untouched++;
      return;
    }

    const currentStatus = tStatusCol !== -1 ? String(row[tStatusCol]).trim() : '';
    if (stagingStatusScope.size > 0 && stagingStatusScope.has(currentStatus)) {
      toArchive.push(row);
      removedGoneFromStatus++;
      return;
    }

    const hours = setProcessingTime(row);
    if (hours !== null && hours < CONFIG.minProcessingHours) {
      droppedTooFresh++;
      return;
    }
    ensureFirstSeen(row);
    result.push(row);
    untouched++;
  });

  stagingRows.forEach(stagingRow => {
    const id = String(stagingRow[sIdCol]).trim();
    if (trackingRowsById.has(id)) return;
    const newRow = new Array(tHeaders.length).fill('');
    newRow[tIdCol] = id;
    applyFieldMap(newRow, stagingRow);
    if (tFirstSeenCol !== -1) newRow[tFirstSeenCol] = now;
    const hours = setProcessingTime(newRow);
    if (matchesLane && matchesLane(stagingRow)) {
      laneResult.push(newRow);
      added++;
      return;
    }
    if (hours !== null && hours < CONFIG.minProcessingHours) {
      droppedTooFresh++;
      return;
    }
    result.push(newRow);
    added++;
  });

  trackingSheet.clearContents();
  trackingSheet.getRange(1, 1, 1, tHeaders.length).setValues([tHeaders]);
  if (result.length > 0) {
    trackingSheet.getRange(2, 1, result.length, tHeaders.length).setValues(result);
  }

  // Спец-лист перезаписываем целиком при КАЖДОЙ синхронизации этого типа
  // (даже если laneResult пуст) — иначе тикеты, вернувшиеся в обычный
  // Tracking или уехавшие в Архив, останутся продублированными на нём.
  if (laneConfig) {
    if (!laneSheet) {
      laneSheet = ss.insertSheet(laneConfig.sheetName);
    }
    laneSheet.clearContents();
    laneSheet.getRange(1, 1, 1, tHeaders.length).setValues([tHeaders]);
    if (laneResult.length > 0) {
      laneSheet.getRange(2, 1, laneResult.length, tHeaders.length).setValues(laneResult);
    }
  }

  if (toArchive.length > 0) {
    let archiveSheet = ss.getSheetByName(typeConfig.archiveSheet);
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(typeConfig.archiveSheet);
    }
    if (archiveSheet.getLastRow() === 0) {
      archiveSheet.getRange(1, 1, 1, tHeaders.length).setValues([tHeaders]);
    }
    const startRow = archiveSheet.getLastRow() + 1;
    archiveSheet.getRange(startRow, 1, toArchive.length, tHeaders.length).setValues(toArchive);
  }

  return {
    typeValue: typeConfig.value,
    added: added,
    updated: updated,
    removedGoneFromStatus: removedGoneFromStatus,
    removedFromLane: removedFromLane,
    droppedTooFresh: droppedTooFresh,
    untouched: untouched,
    total: result.length,
    laneSheetName: laneConfig ? laneConfig.sheetName : null,
    laneTotal: laneConfig ? laneResult.length : null,
    firstSeenBackfilled: firstSeenBackfilled,
    excludedByStatus: excludedByStatus,
    excludedByGeoStatus: excludedByGeoStatus,
    headerLikeRowsRemoved: headerLikeRowsRemoved,
  };
}

/*
  Полный список колонок, которые ОБЯЗАНЫ быть в каждом Tracking-листе
  (и в каждом спец-листе — структура у них та же). Собирается из
  конфига, чтобы при добавлении новой строки в CONFIG.fieldMap проверка
  расширялась сама и нигде не приходилось дублировать список руками.
  Ручные колонки команды (Причина зависания, Актуальный статус,
  Результат) сюда НЕ входят — без них синхронизация технически
  работает, их наличие проверяет Диагностика колонок.
*/
function requiredTrackingHeaders() {
  const headers = Object.keys(CONFIG.fieldMap);
  [
    CONFIG.idHeaderTracking,
    CONFIG.paymentTypeHeader,
    CONFIG.firstSeenHeader,
    CONFIG.statusEntryDateHeader,
    CONFIG.processingTimeHeader,
    CONFIG.statusHeaderTracking,
  ].forEach(h => {
    if (h && headers.indexOf(h) === -1) headers.push(h);
  });
  return headers;
}

/*
  Полный список колонок, которые ОБЯЗАНЫ быть в Буфере: все источники
  из CONFIG.fieldMap плюс служебные колонки (Ticket ID, Ticket type,
  Topic, колонка ГЕО для гео-фильтра, колонки, нужные каждому правилу
  CONFIG.specialRouting).
*/
function requiredStagingHeaders() {
  const headers = Object.keys(CONFIG.fieldMap).map(k => CONFIG.fieldMap[k]);
  const extra = [
    CONFIG.idHeaderStaging,
    CONFIG.ticketTypeHeaderStaging,
    CONFIG.paymentTypeSourceHeader,
  ];
  if (CONFIG.geoStatusFilter && (CONFIG.geoStatusFilter.rules || []).length > 0) {
    extra.push(CONFIG.geoStatusFilter.geoHeaderStaging);
  }
  (CONFIG.specialRouting || []).forEach(lane => {
    if (lane.kind === 'statusComment') {
      extra.push(lane.statusHeaderStaging);
      extra.push(lane.commentHeaderStaging);
    } else if (lane.kind === 'geoWhitelist') {
      extra.push(lane.geoHeaderStaging);
    }
  });
  extra.forEach(h => {
    if (h && headers.indexOf(h) === -1) headers.push(h);
  });
  return headers;
}

// Заголовки листа "Лог переноса" в том виде, в каком их пишет скрипт.
function manualArchiveLogHeaders() {
  return CONFIG.manualArchive.logFields.map(f => f.logHeader).concat(['Дата переноса']);
}

/*
  Возвращает список отсутствующих заголовков (в порядке required).
*/
function missingHeaders(actualHeaders, required) {
  return required.filter(h => actualHeaders.indexOf(h) === -1);
}

/*
  Подсказка по ненайденному заголовку: ищет среди имеющихся похожий
  (совпадающий без учёта регистра и пробелов, либо начинающийся так же)
  и показывает посимвольные hex-коды обоих. Так видно гомоглифы
  (кириллическая "а" против латинской "a") и невидимые пробелы.
*/
function headerHint(actualHeaders, expected) {
  const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
  const target = norm(expected);
  if (target === '') return '';

  // Ищем максимально похожий заголовок по доле совпавших символов на
  // тех же позициях. Гомоглиф даёт совпадение около 0.9, поэтому порог
  // 0.6 ловит и одну подменённую букву, и лишний символ.
  let similar = null;
  let bestScore = 0;
  actualHeaders.forEach(h => {
    const n = norm(h);
    if (n === '') return;
    let same = 0;
    const common = Math.min(n.length, target.length);
    for (let i = 0; i < common; i++) {
      if (n[i] === target[i]) same++;
    }
    const score = same / Math.max(n.length, target.length);
    if (score > bestScore) {
      bestScore = score;
      similar = h;
    }
  });
  if (similar === null || bestScore < 0.6) return '';

  return '\n      похоже на: "' + similar + '"' +
         '\n      в листе:  [' + charCodes(similar) + ']' +
         '\n      ожидаем:  [' + charCodes(expected) + ']';
}

/*
  Проверяет, что в Буфере есть все колонки-источники. Вызывается один
  раз в начале syncTickets(): если чего-то нет, синхронизация не
  начинается вообще и Буфер остаётся нетронутым.
*/
function assertStagingHeaders(sHeaders) {
  const missing = missingHeaders(sHeaders, requiredStagingHeaders());
  if (missing.length === 0) return;
  throw new Error('В листе "' + CONFIG.stagingSheetName +
    '" не найдены колонки выгрузки: ' + missing.join(', ') + '.' +
    missing.map(h => headerHint(sHeaders, h)).join('') +
    '\nПроверьте, что вставлена свежая выгрузка целиком и с заголовками. ' +
    'Синхронизация не запущена, Буфер не очищен.');
}

/*
  Проверяет, что в Tracking-листе есть все обязательные колонки.
  Падает до любых изменений, чтобы не получить лист, где новая колонка
  молча остаётся пустой у всех тикетов.
*/
function assertTrackingHeaders(sheetName, tHeaders) {
  const missing = missingHeaders(tHeaders, requiredTrackingHeaders());
  if (missing.length === 0) return;
  throw new Error('В листе "' + sheetName + '" не найдены колонки: ' +
    missing.join(', ') + '.' +
    missing.map(h => headerHint(tHeaders, h)).join('') +
    '\nДобавьте их (написание должно совпадать посимвольно) и запустите ' +
    'синхронизацию заново. Поможет пункт меню "Диагностика колонок".');
}

/*
  Проверяет, что заголовки архивного листа совпадают с заголовками
  листа-источника. Скрипт дописывает строки в конец архива по позициям
  колонок, не сверяясь с его шапкой, поэтому расхождение (например,
  колонку добавили в Tracking и забыли в Архив) означает, что все новые
  записи лягут со сдвигом. Лист, которого ещё нет или который пуст, —
  не ошибка: заголовки в него запишутся при первом переносе.
*/
function assertArchiveHeaders(ss, archiveSheetName, headers) {
  const sheet = ss.getSheetByName(archiveSheetName);
  if (!sheet || sheet.getLastRow() === 0) return;

  if (sheet.getMaxColumns() < headers.length) {
    throw new Error('В листе "' + archiveSheetName + '" меньше колонок, чем в ' +
      'исходном листе (' + sheet.getMaxColumns() + ' против ' + headers.length +
      '). Добавьте недостающие колонки в архив в тех же позициях, иначе ' +
      'переносимые тикеты лягут со сдвигом.');
  }

  const actual = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const diff = [];
  for (let i = 0; i < headers.length; i++) {
    if (String(actual[i]) !== String(headers[i])) {
      diff.push('колонка ' + (i + 1) + ': в архиве "' + actual[i] +
        '", ожидалось "' + headers[i] + '"');
    }
  }
  if (diff.length === 0) return;

  throw new Error('Заголовки листа "' + archiveSheetName +
    '" не совпадают с исходным листом:\n  ' + diff.join('\n  ') +
    '\nПриведите их к одинаковому виду (новые колонки вставляйте через ' +
    '"Вставить столбец" в той же позиции — тогда старые записи архива ' +
    'сдвинутся вместе со своими данными). Ничего не перенесено.');
}

/*
  Проверяет, что заголовки Лога переноса совпадают с тем, что пишет
  скрипт (CONFIG.manualArchive.logFields + "Дата переноса"). Нужна после
  любого изменения logFields — иначе новые записи лягут со сдвигом
  относительно уже накопленных. Листа ещё нет — не ошибка, он создастся
  сам с правильной шапкой.
*/
function assertManualArchiveLogHeaders(ss) {
  const sheet = ss.getSheetByName(CONFIG.manualArchive.logSheetName);
  if (!sheet || sheet.getLastRow() === 0) return;

  const expected = manualArchiveLogHeaders();
  if (sheet.getMaxColumns() < expected.length) {
    throw new Error('В листе "' + CONFIG.manualArchive.logSheetName +
      '" меньше колонок, чем нужно (' + sheet.getMaxColumns() + ' против ' +
      expected.length + '). Ожидаемая шапка: ' + expected.join(' | ') + '.');
  }

  const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  if (actual.join('') === expected.join('')) return;

  throw new Error('Заголовки листа "' + CONFIG.manualArchive.logSheetName +
    '" не совпадают с ожидаемыми.\n  Сейчас:   ' + actual.join(' | ') +
    '\n  Ожидаем:  ' + expected.join(' | ') +
    '\nВставьте недостающую колонку через "Вставить столбец" в нужной ' +
    'позиции (тогда старые записи сдвинутся вместе с данными). ' +
    'Ничего не перенесено.');
}

/*
  Сбрасывает фильтрацию на листе: очищает условия базового фильтра
  (сам фильтр НЕ удаляется — у команды остаются выпадашки, просто в
  состоянии "показать всё") и раскрывает скрытые строки и столбцы.
  Вызывается перед чтением каждого листа, чтобы синхронизация и ручные
  правки всегда работали с полным набором данных. Личные режимы
  фильтрации (Filter views) не затрагиваются — они видны только их
  владельцу и на данные не влияют.
*/
function resetSheetFilters(sheet) {
  if (!sheet) return;

  const filter = sheet.getFilter();
  if (filter) {
    const range = filter.getRange();
    for (let c = range.getColumn(); c <= range.getLastColumn(); c++) {
      if (filter.getColumnFilterCriteria(c)) {
        filter.removeColumnFilterCriteria(c);
      }
    }
  }

  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) sheet.showRows(1, maxRows);
  const maxCols = sheet.getMaxColumns();
  if (maxCols > 0) sheet.showColumns(1, maxCols);
}

/*
  Кнопка меню: переносит решённые вручную тикеты (см. CONFIG.manualArchive)
  из всех 4 Tracking-листов И всех спец-листов в их Архивы, независимо
  от синхронизации. Эта же логика на уровне одного типа
  (archiveManuallyResolvedForType) вызывается автоматически в конце
  syncTickets().
*/
function archiveManuallyResolvedTickets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const summaries = CONFIG.types.map(typeConfig => {
    try {
      return archiveManuallyResolvedForType(ss, typeConfig);
    } catch (e) {
      return { typeValue: typeConfig.value, error: e.message, archived: 0 };
    }
  });

  const total = summaries.reduce((sum, s) => sum + (s.archived || 0), 0);

  const lines = summaries.map(s => {
    if (s.error) return s.typeValue + ': ОШИБКА: ' + s.error;
    const laneConfig = SPECIAL_ROUTING_BY_TYPE.get(s.typeValue);
    let line = s.typeValue + ': перенесено ' + s.archived +
      ' (в лог ' + (s.archivedLogged || 0) + ', без подсчёта ' +
      (s.archived - (s.archivedLogged || 0)) +
      (s.archivedFromLane && laneConfig ? ', из "' + laneConfig.sheetName + '" ' + s.archivedFromLane : '') + ')';
    if (s.garbageRemoved) {
      line += ', удалено строк-дублей заголовка: ' + s.garbageRemoved;
    }
    return line;
  });

  SpreadsheetApp.getUi().alert(
    'Перенос решённых тикетов завершён.\n\nВсего перенесено: ' + total + '\n\n' + lines.join('\n')
  );
}

/*
  Переносит решённые вручную тикеты одного типа в его Архив: сначала
  из его Tracking-листа, а если у типа есть спец-лист
  (CONFIG.specialRouting) — ещё и с него (тоже в общий архив типа).
  Счётчики суммируются, отдельно возвращается archivedFromLane — сколько
  из них пришло со спец-листа.
*/
function archiveManuallyResolvedForType(ss, typeConfig) {
  const main = archiveManuallyResolvedFromSheet(
    ss, typeConfig.trackingSheet, typeConfig.archiveSheet, true);

  const laneConfig = SPECIAL_ROUTING_BY_TYPE.get(typeConfig.value);
  // Спец-листа может ещё не существовать (до первой синхронизации) —
  // это не ошибка, просто нечего переносить.
  const lane = laneConfig
    ? archiveManuallyResolvedFromSheet(ss, laneConfig.sheetName, typeConfig.archiveSheet, false)
    : { archived: 0, archivedLogged: 0, garbageRemoved: 0 };

  return {
    typeValue: typeConfig.value,
    archived: main.archived + lane.archived,
    archivedLogged: main.archivedLogged + lane.archivedLogged,
    archivedFromLane: lane.archived,
    garbageRemoved: (main.garbageRemoved || 0) + (lane.garbageRemoved || 0),
  };
}

/*
  Переносит решённые вручную тикеты с ОДНОГО листа (Tracking или
  спец-лист) в указанный Архив, и пишет запись о каждом (по правилам с
  log: true) в Лог переноса. mustExist управляет реакцией на отсутствие
  листа: true — понятная ошибка (Tracking-лист обязан существовать),
  false — тихий ноль (спец-лист создаётся только при первой синхронизации).
*/
function archiveManuallyResolvedFromSheet(ss, sheetName, archiveSheetName, mustExist) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    if (mustExist) {
      throw new Error('Лист "' + sheetName + '" не найден.');
    }
    return { archived: 0, archivedLogged: 0, garbageRemoved: 0 };
  }

  // Сбрасываем фильтрацию до чтения и перезаписи листа.
  resetSheetFilters(sheet);

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { archived: 0, archivedLogged: 0, garbageRemoved: 0 };
  }

  const headers = data[0];

  // Сверяем заголовки архива и лога ДО перезаписи листа: если структура
  // разъехалась, лучше упасть здесь, пока строки ещё на месте, чем
  // вычистить их из Tracking и дописать в архив со сдвигом.
  assertArchiveHeaders(ss, archiveSheetName, headers);
  assertManualArchiveLogHeaders(ss);

  const rows = data.slice(1);
  const now = new Date();

  const keep = [];
  const toArchive = [];
  const logEntries = [];
  // Строки-дубли заголовка (см. looksLikeHeaderRow) просто выбрасываются —
  // это не решённый тикет, архивировать и логировать их не нужно, они
  // молча пропадают при следующей перезаписи листа.
  let garbageRemoved = 0;

  rows.forEach(row => {
    if (looksLikeHeaderRow(row, headers)) {
      garbageRemoved++;
      return;
    }
    const rule = findManualArchiveRule(headers, row);
    if (rule) {
      toArchive.push(row);
      // В Лог переноса (счётчик сделанного нами) попадают только
      // тикеты, перенесённые по правилам с log: true.
      if (rule.log) {
        logEntries.push(buildManualArchiveLogEntry(headers, row, now));
      }
    } else {
      keep.push(row);
    }
  });

  if (toArchive.length === 0 && garbageRemoved === 0) {
    return { archived: 0, archivedLogged: 0, garbageRemoved: 0 };
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (keep.length > 0) {
    sheet.getRange(2, 1, keep.length, headers.length).setValues(keep);
  }

  if (toArchive.length > 0) {
    let archiveSheet = ss.getSheetByName(archiveSheetName);
    if (!archiveSheet) {
      archiveSheet = ss.insertSheet(archiveSheetName);
    }
    if (archiveSheet.getLastRow() === 0) {
      archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    const archiveStartRow = archiveSheet.getLastRow() + 1;
    archiveSheet.getRange(archiveStartRow, 1, toArchive.length, headers.length).setValues(toArchive);
  }

  appendToManualArchiveLog(ss, logEntries);

  return { archived: toArchive.length, archivedLogged: logEntries.length, garbageRemoved: garbageRemoved };
}

/*
  Возвращает первое правило из CONFIG.manualArchive.rules, у которого
  совпали ВСЕ условия, или null, если ни одно правило не совпало.
*/
function findManualArchiveRule(headers, row) {
  for (let i = 0; i < CONFIG.manualArchive.rules.length; i++) {
    const rule = CONFIG.manualArchive.rules[i];
    const allMatch = rule.conditions.every(cond => {
      const col = headers.indexOf(cond.header);
      if (col === -1) return false;
      return String(row[col]).trim() === cond.value;
    });
    if (allMatch) return rule;
  }
  return null;
}

/*
  Собирает одну строку для Лог переноса из полей
  CONFIG.manualArchive.logFields плюс дату переноса последней колонкой.
*/
function buildManualArchiveLogEntry(headers, row, now) {
  const values = CONFIG.manualArchive.logFields.map(f => {
    const col = headers.indexOf(f.trackingHeader);
    return col !== -1 ? row[col] : '';
  });
  values.push(now);
  return values;
}

/*
  Дописывает записи в накопительный лист Лог переноса, создавая его
  при первом обращении (с заголовками и живой формулой-счётчиком).
*/
function appendToManualArchiveLog(ss, entries) {
  if (!entries || entries.length === 0) return;

  const logHeaders = manualArchiveLogHeaders();
  let logSheet = ss.getSheetByName(CONFIG.manualArchive.logSheetName);

  if (!logSheet) {
    logSheet = ss.insertSheet(CONFIG.manualArchive.logSheetName);
    logSheet.getRange(1, 1, 1, logHeaders.length).setValues([logHeaders]);
    const labelCol = logHeaders.length + 2;
    logSheet.getRange(1, labelCol).setValue('Итого перенесено:');
    logSheet.getRange(1, labelCol + 1).setFormula('=COUNTA(A2:A)');
  }

  const startRow = logSheet.getLastRow() + 1;
  logSheet.getRange(startRow, 1, entries.length, logHeaders.length).setValues(entries);
}

/*
  Диагностика структуры листов (пункт меню "Диагностика колонок").
  Проверяет всё, на чём обычно ломается синхронизация:
   - Буфер: есть ли все колонки-источники из CONFIG.fieldMap и служебные;
   - Tracking-листы и все спец-листы: есть ли все обязательные колонки,
     плюс ручные колонки команды, плюс сколько строк с пустой Датой
     фиксации;
   - Архивы: совпадают ли заголовки с соответствующим Tracking-листом;
   - Лог переноса: совпадает ли шапка с CONFIG.manualArchive.logFields.
  При промахе по заголовку показывает похожий заголовок и посимвольные
  hex-коды обоих — так ловятся гомоглифы (кириллическая "а" против
  латинской) и невидимые пробелы.
  Результат пишется в Logger (виден при запуске из редактора) и, если
  доступен UI, показывается алертом.
*/
function diagnoseFirstSeen() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lines = [];

  function headersOf(sheet) {
    if (!sheet) return null;
    if (sheet.getLastRow() === 0) return [];
    return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  function reportMissing(headers, required) {
    const missing = missingHeaders(headers, required);
    if (missing.length === 0) return '  колонки на месте';
    return missing.map(h => '  НЕТ КОЛОНКИ: "' + h + '"' + headerHint(headers, h)).join('\n');
  }

  // --- Буфер ---
  const stagingSheet = ss.getSheetByName(CONFIG.stagingSheetName);
  const sHeaders = headersOf(stagingSheet);
  if (sHeaders === null) {
    lines.push(CONFIG.stagingSheetName + ': лист не найден');
  } else if (sHeaders.length === 0) {
    lines.push(CONFIG.stagingSheetName + ': лист пуст (выгрузка не вставлена)');
  } else {
    lines.push(CONFIG.stagingSheetName + ':');
    lines.push(reportMissing(sHeaders, requiredStagingHeaders()));
  }

  // --- Tracking-листы и все спец-листы ---
  // Ручные колонки команды берём из правил переноса решённых: без них
  // синхронизация работает, но кнопка "Перенести решённые" молчит.
  const manualHeaders = [];
  CONFIG.manualArchive.rules.forEach(rule => {
    rule.conditions.forEach(cond => {
      if (manualHeaders.indexOf(cond.header) === -1) manualHeaders.push(cond.header);
    });
  });

  const trackingNames = CONFIG.types.map(t => t.trackingSheet)
    .concat(CONFIG.specialRouting.map(l => l.sheetName));

  trackingNames.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { lines.push('"' + name + '": лист не найден'); return; }

    const data = sheet.getDataRange().getValues();
    if (data.length === 0) { lines.push('"' + name + '": лист пуст'); return; }

    const headers = data[0];
    lines.push('"' + name + '":');
    lines.push(reportMissing(headers, requiredTrackingHeaders().concat(manualHeaders)));

    const col = headers.indexOf(CONFIG.firstSeenHeader);
    if (col === -1) return;

    const idCol = headers.indexOf(CONFIG.idHeaderTracking);
    const emptyIds = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][col]).trim() === '') {
        emptyIds.push(idCol !== -1 ? String(data[i][idCol]) : 'строка ' + (i + 1));
      }
    }
    lines.push('  пустых "' + CONFIG.firstSeenHeader + '" — ' + emptyIds.length +
      (emptyIds.length ? ' (' + emptyIds.slice(0, 15).join(', ') +
        (emptyIds.length > 15 ? ', …' : '') + ')' : ''));

    // Строки-дубли заголовка (см. looksLikeHeaderRow) — кто-то случайно
    // вставил шапку таблицы как обычную строку данных. Сам следующий
    // запуск синхронизации/переноса решённых их удалит, но полезно видеть
    // это здесь тоже, если синхронизация давно не запускалась.
    const headerLikeRows = [];
    for (let i = 1; i < data.length; i++) {
      if (looksLikeHeaderRow(data[i], headers)) headerLikeRows.push('строка ' + (i + 1));
    }
    if (headerLikeRows.length > 0) {
      lines.push('  ⚠ строк-дублей заголовка — ' + headerLikeRows.length +
        ' (' + headerLikeRows.slice(0, 15).join(', ') +
        (headerLikeRows.length > 15 ? ', …' : '') + ') — удалятся сами при следующей синхронизации');
    }
  });

  // --- Архивы: шапка должна совпадать со своим Tracking-листом ---
  CONFIG.types.forEach(typeConfig => {
    const trackingSheet = ss.getSheetByName(typeConfig.trackingSheet);
    const tHeaders = headersOf(trackingSheet);
    if (!tHeaders || tHeaders.length === 0) return;
    try {
      assertArchiveHeaders(ss, typeConfig.archiveSheet, tHeaders);
      lines.push('"' + typeConfig.archiveSheet + '": шапка совпадает с "' +
        typeConfig.trackingSheet + '"');
    } catch (e) {
      lines.push('"' + typeConfig.archiveSheet + '": ' + e.message);
    }
  });

  // --- Лог переноса ---
  try {
    assertManualArchiveLogHeaders(ss);
    lines.push('"' + CONFIG.manualArchive.logSheetName + '": шапка в порядке (' +
      manualArchiveLogHeaders().join(' | ') + ')');
  } catch (e) {
    lines.push('"' + CONFIG.manualArchive.logSheetName + '": ' + e.message);
  }

  const message = 'Диагностика колонок\n\n' + lines.join('\n');
  Logger.log(message);
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // Запуск из редактора — UI недоступен, результат уже в Logger.
  }
}

/*
  Посимвольные hex-коды строки — для сравнения заголовков и ловли
  гомоглифов (кириллическая "а" = 430, латинская "a" = 61 и т.п.).
*/
function charCodes(s) {
  return String(s).split('').map(c => c.charCodeAt(0).toString(16)).join(' ');
}

/*
  Определяет, является ли строка данных случайно задублированной строкой
  заголовков — например, кто-то скопировал шапку таблицы вместе с данными
  и вставил её повторно ниже, или продублировал строку 1 через протяжку.
  Возвращает true, только если ВСЕ ячейки строки побайтово совпадают со
  своими заголовками — у настоящего тикета такое совпадение сразу по всем
  колонкам практически невозможно, так что ложных срабатываний не будет.
  Без этой проверки такая строка осталась бы в Tracking/на спец-листе
  навсегда: её "Ticket ID" (буквально "Ticket ID") не встретится ни в
  одной выгрузке, а её "Статус зависания" (буквально "Статус зависания")
  никогда не попадёт в статус-скоуп — то есть ни обновиться, ни
  заархивироваться она не может, и просто переписывается как есть на
  каждой синхронизации.
*/
function looksLikeHeaderRow(row, headers) {
  for (let i = 0; i < headers.length; i++) {
    if (String(row[i]).trim() !== String(headers[i]).trim()) return false;
  }
  return true;
}

/*
  Пункт меню "Тикеты" -> "Синхронизировать" для запуска кнопкой.
*/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Тикеты')
    .addItem('Синхронизировать', 'syncTickets')
    .addItem('Перенести решённые в архив', 'archiveManuallyResolvedTickets')
    .addItem('Диагностика колонок', 'diagnoseFirstSeen')
    .addToUi();
}
