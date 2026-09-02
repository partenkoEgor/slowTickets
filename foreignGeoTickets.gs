/*
  Отслеживание тикетов с ГЕО, отличным от списка "наших" ГЕО
  (CONFIG.knownGeos), с разбивкой по Ticket type на 2 отдельных листа.

  Это модификация скрипта синхронизации зависших тикетов (Буфер → Tracking
  → Архив, ручной перенос решённых, диагностика колонок) — архитектура и
  большая часть механики те же самые. Отличия от исходного скрипта:

   - Обрабатываются только 2 типа тикетов — API и PSP (не 4).
   - Нет специального листа "for TA" и связанной с ним маршрутизации —
     в исходном скрипте она была нужна только для типа BT M, которого
     здесь нет.
   - Нет фильтра по 72 часам (minProcessingHours) — тикет остаётся в
     Tracking независимо от того, сколько он уже висит в статусе.
     Processing time всё равно считается и пишется в свою колонку —
     просто по нему больше ничего не отбрасывается.
   - Вместо гео-фильтра по статусам (для одного конкретного ГЕО) — фильтр
     по СПИСКУ ГЕО, с которыми компания работает (CONFIG.knownGeos).
     Строка Буфера, чьё ГЕО есть в этом списке, отбрасывается в самом
     начале обработки типа — цель этой таблицы прямо противоположная
     исходной: она ловит тикеты из ГЕО, которых в списке НЕТ ("чужие"
     ГЕО), а не наоборот.

  Листы
   - Буфер — общий лист, сюда вставляется выгрузка целиком, как есть,
     с заголовками в первой строке. Может содержать любые типы и любые
     ГЕО вперемешку — скрипт сам отбирает нужное.
   - API, PSP — 2 листа Tracking, по одному на тип. Структура (заголовки)
     одинаковая на обоих листах — та же, что в исходном скрипте (Тип
     платежа, Дата фиксации, Дата создания тикета, Дата входа в статус,
     Processing time, ГЕО, Субагент, Департамент, Ticket ID, User ID,
     Статус зависания, Причина зависания, Актуальный статус, Результат,
     Комментарий).
     Тип платежа и Департамент заполняются так же, как в исходном
     скрипте (см. CONFIG.paymentTypeMap и CONFIG.fieldMap).
   - API Архив, PSP Архив — сюда переносятся
     тикеты соответствующего типа, которые реально вышли из своего
     отслеживаемого статуса, а также тикеты, вручную помеченные командой
     как решённые (см. ниже). Создаются автоматически при первом
     переносе.

  Исключённые статусы (CONFIG.excludedStatuses)
   Тот же список и та же логика, что и в исходном скрипте: строки
   выгрузки, у которых External Status равен одному из значений этого
   списка (без учёта регистра), отбрасываются в самом начале обработки —
   как будто их в выгрузке вообще не было. Фильтр применяется к обоим
   типам одинаково. Следствия те же, что в исходном скрипте:
    - новый тикет с таким статусом в Tracking не добавляется;
    - тикет, уже живущий в Tracking и пришедший в выгрузке с таким
      статусом, считается пропавшим из выгрузки — если его текущий
      статус входит в статус-скоуп этой выгрузки, уходит в Архив, иначе
      остаётся в Tracking как есть;
    - исключённые статусы не участвуют в расчёте статус-скоупа выгрузки.
   В алерте синхронизации — счётчик "исключено по статусу: N".

  Фильтр по "нашим" ГЕО (CONFIG.knownGeos)
   Строки Буфера, чьё значение колонки Country (см.
   CONFIG.geoHeaderStaging) совпадает (без учёта регистра, без пробелов
   по краям) с одним из значений CONFIG.knownGeos, отбрасываются в самом
   начале обработки типа — точно так же, как строки из
   CONFIG.excludedStatuses. Смысл: эта таблица должна ловить только
   тикеты из ГЕО, которых нет в списке "наших". Следствия те же самые:
    - новый тикет с "нашим" ГЕО в Tracking не добавляется (он и не
      должен здесь быть);
    - тикет, уже почему-то живущий в этом Tracking-листе и пришедший в
      выгрузке с "нашим" ГЕО, считается пропавшим из выгрузки — если его
      текущий статус входит в статус-скоуп этой выгрузки, уходит в
      Архив, иначе остаётся в Tracking как есть;
    - такие строки не участвуют в расчёте статус-скоупа выгрузки.
   ВАЖНО: значения CONFIG.knownGeos должны быть записаны точно так же,
   как они приходят в колонке Country выгрузки (сейчас предполагается,
   что это английские названия стран — Bahrain, Algeria и т.п.). Если
   реальная выгрузка отдаёт другое написание (например, с диакритикой
   или под другим именем страны) — поправьте список, ничего в логике
   менять не нужно. Про рискованные с точки зрения написания страны
   (ОАЭ, Кыргызстан, Турция, Южный Судан/Судан, Папуа — Новая Гвинея) —
   см. комментарий прямо над списком в CONFIG.
   В алерте синхронизации — счётчик "исключено (наш ГЕО): N".

  Ручной перенос тикетов в архив
   Тикет из любого Tracking-листа переносится в свой Архив, если совпали
   ВСЕ условия хотя бы одного правила из CONFIG.manualArchive.rules
   (правила проверяются по порядку, применяется первое совпавшее):
    1) Актуальный статус = "В работе" И Результат = "Решено".
    2) Результат = "Решено" при любом другом статусе.
    3) Результат = "Закрыт пользователем".
   "В работе у профильной команды" или пустой Результат — не финал,
   тикет остаётся в Tracking. Отдельного журнала перенесённых тикетов
   в этой таблице нет — перенос сразу в Архив, без записи куда-либо ещё.
   Проверка выполняется отдельной функцией
   archiveManuallyResolvedTickets() — её можно запустить кнопкой в меню,
   и она же автоматически прогоняется в конце syncTickets() для каждого
   успешно синхронизированного типа.

  Надёжность данных (защита от дыр в Дате фиксации и съехавших строк)
   Та же механика, что и в исходном скрипте:
   - resetSheetFilters() перед чтением каждого листа (Буфер, Tracking) —
     сбрасывает условия базового фильтра и раскрывает скрытые строки и
     столбцы.
   - Проверка структуры ДО любых изменений (assertStagingHeaders,
     assertTrackingHeaders, assertArchiveHeaders) — если не хватает
     колонки, синхронизация падает с понятной ошибкой вместо того, чтобы
     молча оставить поле пустым или дописать архив со сдвигом.
   - Страховочный backfill пустой Даты фиксации у строки, остающейся в
     Tracking, — заполняется текущей датой, уже заполненные даты не
     трогаются.
   - Пункт меню "Диагностика колонок" (diagnoseFirstSeen) — для разбора
     проблем со структурой листов.

  Логика для КАЖДОГО типа выполняется независимо (на своей паре
  staging-подмножество / свой Tracking-лист):

   1. Из Буфера берём только строки с нужным Ticket type, отбрасываем
      строки со статусами из CONFIG.excludedStatuses и строки с ГЕО из
      CONFIG.knownGeos, среди оставшихся убираем дубли по Ticket ID.
   2. Определяем, какие статусы присутствуют среди ЭТИХ строк
      (статус-скоуп для этого конкретного типа в этой выгрузке).
   3. Тикет в Tracking, который нашёлся среди этих строк (по Ticket ID) —
      обновляется (статус, Дата входа в статус и т.д.), пересчитывается
      Processing time.
   4. Тикет в Tracking, который НЕ нашёлся, но его текущий статус входит
      в статус-скоуп этой выгрузки — переносится в свой Архив.
   5. Тикет, чей статус не входит в статус-скоуп — не трогается (просто
      пересчитывается Processing time).
   6. Новые тикеты этого типа с "чужим" ГЕО, которых раньше не было в
      Tracking, — добавляются. Дата фиксации = сегодня.
   Фильтра по минимальному времени в статусе здесь нет — в отличие от
   исходного скрипта, ни одна строка не отбрасывается из-за того, что
   "слишком свежая".

  Буфер целиком очищается только если ОБА типа обработались без ошибок
  (например, если забыли создать один из листов Tracking — Буфер не
  тронем, чтобы не потерять данные; почините лист и запустите заново).
*/

const CONFIG = {
  stagingSheetName: 'Буфер',
  ticketTypeHeaderStaging: 'Ticket type',

  idHeaderTracking: 'Ticket ID',
  idHeaderStaging: 'Ticket ID',

  statusHeaderTracking: 'Статус зависания',

  // tracking-колонка -> staging-колонка (выгрузка). Одинаковый маппинг для обоих типов.
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

  // Статусы выгрузки, тикеты с которыми в таблицу не попадают ВООБЩЕ —
  // строки Буфера с таким External Status отбрасываются в самом начале
  // обработки типа, как будто их в выгрузке не было. Сравнение без учёта
  // регистра, пробелы по краям игнорируются. Тот же список, что и в
  // исходном скрипте.
  excludedStatuses: [
    'Individual approval',
    'Approval of compensation',
    'In progress PS',
    'Transaction verification',
  ],

  // Колонка Буфера с ГЕО тикета.
  geoHeaderStaging: 'Country',

  // Список ГЕО, с которыми компания работает. Строка Буфера отбрасывается
  // на этапе отбора, если её ГЕО (колонка Country) совпадает с одним из
  // этих значений — таблица должна ловить только "чужие" ГЕО, то есть
  // всё, чего в этом списке нет. Сравнение без учёта регистра, пробелы
  // по краям игнорируются.
  //
  // ВНИМАНИЕ: список ниже — предположительное написание на английском,
  // как обычно называются страны в подобных выгрузках. Названия стран,
  // у которых возможны варианты написания (ОАЭ, Кыргызстан, Турция,
  // Южный Судан/Судан, Папуа — Новая Гвинея, Доминиканская Республика),
  // стоит сверить с реальным значением в колонке Country при первом
  // запуске — быстрее всего через "Диагностика колонок" или просто
  // посмотрев, что реально приходит, и поправить строку(и) списка.
  knownGeos: [
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
  ],

  // Правила ручного переноса тикетов в архив (см. шапку файла и
  // archiveManuallyResolvedTickets()). Тикет переносится, если совпали
  // ВСЕ условия хотя бы одного правила. Правила проверяются ПО ПОРЯДКУ,
  // применяется первое совпавшее.
  manualArchive: {
    rules: [
      {
        conditions: [
          { header: 'Актуальный статус', value: 'В работе' },
          { header: 'Результат', value: 'Решено' },
        ],
      },
      {
        conditions: [
          { header: 'Результат', value: 'Решено' },
        ],
      },
      {
        conditions: [
          { header: 'Результат', value: 'Закрыт пользователем' },
        ],
      },
    ],
  },

  types: [
    { value: 'API', trackingSheet: 'API', archiveSheet: 'API Архив' },
    { value: 'PSP', trackingSheet: 'PSP', archiveSheet: 'PSP Архив' },
  ],

  clearStagingAfterSync: true,
};

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
  // синхронизация вообще не начинается и Буфер не очищается.
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

  // Буфер чистим только если оба типа прошли без ошибок —
  // иначе можно потерять необработанные строки проблемного типа.
  if (CONFIG.clearStagingAfterSync && !hadError && stagingData.length > 1) {
    stagingSheet.getRange(2, 1, stagingData.length - 1, sHeaders.length).clearContent();
  }

  const lines = summaries.map(s => {
    if (s.error) return s.typeValue + ': ОШИБКА: ' + s.error;
    let line = s.typeValue + ': добавлено ' + s.added + ', обновлено ' + s.updated +
      ', в архив ' + s.removedGoneFromStatus +
      ', не тронуто ' + s.untouched + ', итого ' + s.total +
      ', решено→архив ' + (s.archivedManually || 0);
    if (s.excludedByStatus) {
      line += ', исключено по статусу: ' + s.excludedByStatus;
    }
    if (s.excludedByKnownGeo) {
      line += ', исключено (наш ГЕО): ' + s.excludedByKnownGeo;
    }
    if (s.firstSeenBackfilled) {
      line += ', дозаполнено дат фиксации: ' + s.firstSeenBackfilled;
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
  Синхронизирует один тип тикетов: подмножество строк Буфера этого типа
  (только "чужие" ГЕО) против своего листа Tracking и своего листа Архива.
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
  // месте в самом Tracking-листе, и заголовки архива совпадают с ними.
  assertTrackingHeaders(typeConfig.trackingSheet, tHeaders);
  assertArchiveHeaders(ss, typeConfig.archiveSheet, tHeaders);

  const tIdCol = tHeaders.indexOf(CONFIG.idHeaderTracking);
  const tFirstSeenCol = tHeaders.indexOf(CONFIG.firstSeenHeader);
  const tStatusEntryCol = tHeaders.indexOf(CONFIG.statusEntryDateHeader);
  const tProcCol = tHeaders.indexOf(CONFIG.processingTimeHeader);
  const tStatusCol = tHeaders.indexOf(CONFIG.statusHeaderTracking);
  const sStatusCol = sHeaders.indexOf(CONFIG.fieldMap[CONFIG.statusHeaderTracking]);
  const sGeoCol = sHeaders.indexOf(CONFIG.geoHeaderStaging);

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

  // --- Отсев "наших" ГЕО (CONFIG.knownGeos) ---
  // Та же схема, что и у исключённых статусов, только наоборот по смыслу:
  // отбрасываем строки, чьё ГЕО ЕСТЬ в списке "наших" — эта таблица
  // должна ловить только то, чего в списке нет.
  let excludedByKnownGeo = 0;
  const knownGeosLower = (CONFIG.knownGeos || []).map(g => String(g).trim().toLowerCase());
  if (knownGeosLower.length > 0) {
    if (sGeoCol === -1) {
      throw new Error('Колонка "' + CONFIG.geoHeaderStaging +
        '" не найдена в Буфере — фильтр по списку "наших" ГЕО (CONFIG.knownGeos) применить невозможно.');
    }
    stagingRowsAfterExclusion = stagingRowsAfterExclusion.filter(row => {
      const geo = String(row[sGeoCol]).trim().toLowerCase();
      if (knownGeosLower.indexOf(geo) !== -1) {
        excludedByKnownGeo++;
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

  // Статусы, которые покрывает эта выгрузка для этого типа
  const stagingStatusScope = new Set();
  if (sStatusCol !== -1) {
    stagingRows.forEach(r => {
      const v = String(r[sStatusCol]).trim();
      if (v) stagingStatusScope.add(v);
    });
  }

  const trackingRowsById = new Map();
  for (let i = 1; i < trackingData.length; i++) {
    const id = String(trackingData[i][tIdCol]).trim();
    if (id) trackingRowsById.set(id, trackingData[i]);
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

  // Страховка: пустая Дата фиксации у строки, остающейся в Tracking
  // (тикет добавили руками, дату случайно стёрли и т.п.) — заполняем
  // текущей датой. Уже заполненные даты НЕ трогаем: правило ставится
  // один раз при первом добавлении и сохраняется.
  let firstSeenBackfilled = 0;
  function ensureFirstSeen(row) {
    if (tFirstSeenCol === -1) return;
    if (String(row[tFirstSeenCol]).trim() === '') {
      row[tFirstSeenCol] = now;
      firstSeenBackfilled++;
    }
  }

  const result = [];
  const toArchive = [];
  let removedGoneFromStatus = 0;
  let updated = 0;
  let added = 0;
  let untouched = 0;

  trackingRowsById.forEach((row, id) => {
    if (stagingIds.has(id)) {
      const stagingRow = stagingRowById.get(id);
      applyFieldMap(row, stagingRow);
      setProcessingTime(row);
      ensureFirstSeen(row);
      result.push(row);
      updated++;
      return;
    }

    // Тикета нет среди отобранных строк выгрузки (либо реально пропал,
    // либо теперь пришёл с "нашим" ГЕО или исключённым статусом).
    const currentStatus = tStatusCol !== -1 ? String(row[tStatusCol]).trim() : '';
    if (stagingStatusScope.size > 0 && stagingStatusScope.has(currentStatus)) {
      toArchive.push(row);
      removedGoneFromStatus++;
      return;
    }

    setProcessingTime(row);
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
    setProcessingTime(newRow);
    result.push(newRow);
    added++;
  });

  trackingSheet.clearContents();
  trackingSheet.getRange(1, 1, 1, tHeaders.length).setValues([tHeaders]);
  if (result.length > 0) {
    trackingSheet.getRange(2, 1, result.length, tHeaders.length).setValues(result);
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
    untouched: untouched,
    total: result.length,
    firstSeenBackfilled: firstSeenBackfilled,
    excludedByStatus: excludedByStatus,
    excludedByKnownGeo: excludedByKnownGeo,
  };
}

/*
  Полный список колонок, которые ОБЯЗАНЫ быть в каждом Tracking-листе.
  Собирается из конфига, чтобы при добавлении новой строки в
  CONFIG.fieldMap проверка расширялась сама.
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
  Topic, колонка ГЕО для фильтра по "нашим" ГЕО).
*/
function requiredStagingHeaders() {
  const headers = Object.keys(CONFIG.fieldMap).map(k => CONFIG.fieldMap[k]);
  const extra = [
    CONFIG.idHeaderStaging,
    CONFIG.ticketTypeHeaderStaging,
    CONFIG.paymentTypeSourceHeader,
    CONFIG.geoHeaderStaging,
  ];
  extra.forEach(h => {
    if (h && headers.indexOf(h) === -1) headers.push(h);
  });
  return headers;
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
  колонок, не сверяясь с его шапкой, поэтому расхождение означает, что
  все новые записи лягут со сдвигом. Лист, которого ещё нет или который
  пуст, — не ошибка: заголовки в него запишутся при первом переносе.
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
  Сбрасывает фильтрацию на листе: очищает условия базового фильтра
  (сам фильтр НЕ удаляется) и раскрывает скрытые строки и столбцы.
  Вызывается перед чтением каждого листа, чтобы синхронизация и ручные
  правки всегда работали с полным набором данных.
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
  из обоих Tracking-листов в их Архивы, независимо от синхронизации. Эта
  же логика на уровне одного типа (archiveManuallyResolvedForType)
  вызывается автоматически в конце syncTickets().
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
    return s.typeValue + ': перенесено ' + s.archived;
  });

  SpreadsheetApp.getUi().alert(
    'Перенос решённых тикетов завершён.\n\nВсего перенесено: ' + total + '\n\n' + lines.join('\n')
  );
}

/*
  Переносит решённые вручную тикеты одного типа из его Tracking-листа
  в его Архив.
*/
function archiveManuallyResolvedForType(ss, typeConfig) {
  const main = archiveManuallyResolvedFromSheet(
    ss, typeConfig.trackingSheet, typeConfig.archiveSheet, true);

  return {
    typeValue: typeConfig.value,
    archived: main.archived,
  };
}

/*
  Переносит решённые вручную тикеты с ОДНОГО листа в указанный Архив.
  mustExist=true — понятная ошибка, если лист не найден (Tracking-лист
  обязан существовать).
*/
function archiveManuallyResolvedFromSheet(ss, sheetName, archiveSheetName, mustExist) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    if (mustExist) {
      throw new Error('Лист "' + sheetName + '" не найден.');
    }
    return { archived: 0 };
  }

  // Сбрасываем фильтрацию до чтения и перезаписи листа.
  resetSheetFilters(sheet);

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { archived: 0 };
  }

  const headers = data[0];

  // Сверяем заголовки архива ДО перезаписи листа: если структура
  // разъехалась, лучше упасть здесь, пока строки ещё на месте.
  assertArchiveHeaders(ss, archiveSheetName, headers);

  const rows = data.slice(1);

  const keep = [];
  const toArchive = [];

  rows.forEach(row => {
    if (findManualArchiveRule(headers, row)) {
      toArchive.push(row);
    } else {
      keep.push(row);
    }
  });

  if (toArchive.length === 0) {
    return { archived: 0 };
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (keep.length > 0) {
    sheet.getRange(2, 1, keep.length, headers.length).setValues(keep);
  }

  let archiveSheet = ss.getSheetByName(archiveSheetName);
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(archiveSheetName);
  }
  if (archiveSheet.getLastRow() === 0) {
    archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  const archiveStartRow = archiveSheet.getLastRow() + 1;
  archiveSheet.getRange(archiveStartRow, 1, toArchive.length, headers.length).setValues(toArchive);

  return { archived: toArchive.length };
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
  Диагностика структуры листов (пункт меню "Диагностика колонок").
  Проверяет всё, на чём обычно ломается синхронизация:
   - Буфер: есть ли все колонки-источники из CONFIG.fieldMap и служебные;
   - Tracking-листы: есть ли все обязательные колонки, плюс ручные
     колонки команды, плюс сколько строк с пустой Датой фиксации;
   - Архивы: совпадают ли заголовки с соответствующим Tracking-листом.
  При промахе по заголовку показывает похожий заголовок и посимвольные
  hex-коды обоих — так ловятся гомоглифы и невидимые пробелы.
  Результат пишется в Logger (виден при запуске из редактора) и, если
  доступен UI, показывается алертом.
*/
function diagnoseColumns() {
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

  // --- Tracking-листы ---
  // Ручные колонки команды берём из правил переноса решённых: без них
  // синхронизация работает, но кнопка "Перенести решённые" молчит.
  const manualHeaders = [];
  CONFIG.manualArchive.rules.forEach(rule => {
    rule.conditions.forEach(cond => {
      if (manualHeaders.indexOf(cond.header) === -1) manualHeaders.push(cond.header);
    });
  });

  CONFIG.types.map(t => t.trackingSheet).forEach(name => {
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
  Пункт меню "Тикеты — чужие ГЕО" для запуска кнопкой.
*/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Тикеты — чужие ГЕО')
    .addItem('Синхронизировать', 'syncTickets')
    .addItem('Перенести решённые в архив', 'archiveManuallyResolvedTickets')
    .addItem('Диагностика колонок', 'diagnoseColumns')
    .addToUi();
}
