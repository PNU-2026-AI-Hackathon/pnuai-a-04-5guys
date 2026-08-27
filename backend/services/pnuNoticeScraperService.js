const cheerio = require('cheerio')
const { constants, createPublicKey, publicEncrypt } = require('node:crypto')

const ONE_MONTH_MS = 1000 * 60 * 60 * 24 * 30
const MAX_PAGES = 8
const REQUEST_TIMEOUT_MS = 30000
const DORMITORY_LIST_REQUEST = Object.freeze({ pageIndex: 0, pageSize: 100 })

const NOTICE_SOURCES = [
  {
    source: 'pnu-main',
    label: 'PNU Main Notices',
    kind: 'main-cms',
    origin: 'https://www.pusan.ac.kr',
    listUrl: 'https://www.pusan.ac.kr/kor/CMS/Board/Board.do?mCode=MN095&mgr_seq=3',
    maxPages: MAX_PAGES,
    language: 'Korean',
  },
  {
    source: 'onestop',
    label: 'PNU Student Support',
    kind: 'onestop-home',
    // e-onestop.pusan.ac.kr was retired and now 404s on every path, which had
    // been failing this board silently on every sync. The board itself moved to
    // onestop.pusan.ac.kr and still renders the same markup, so the parser is
    // unchanged — only the hostname was wrong.
    origin: 'https://onestop.pusan.ac.kr',
    listUrl: 'https://onestop.pusan.ac.kr/login',
    maxPages: 1,
    language: 'Korean',
  },
  {
    source: 'international',
    label: 'PNU International',
    kind: 'k2web',
    origin: 'https://international.pusan.ac.kr',
    listUrl: 'https://international.pusan.ac.kr/bbs/international/2081/artclList.do',
    maxPages: MAX_PAGES,
    language: 'Korean',
  },
  {
    source: 'cse',
    label: 'CSE Department',
    kind: 'k2web',
    origin: 'https://cse.pusan.ac.kr',
    listUrl: 'https://cse.pusan.ac.kr/bbs/cse/2055/artclList.do',
    maxPages: MAX_PAGES,
    language: 'Korean',
  },
  {
    source: 'dormitory',
    label: 'PNU Dormitory',
    kind: 'dormitory-api',
    origin: 'https://dorm.pusan.ac.kr',
    listUrl: 'https://dorm.pusan.ac.kr/pdorm/page?menuCD=000000000000642',
    menuCode: '000000000000642',
    language: 'Korean',
  },
]

const BOARDS = NOTICE_SOURCES

function noticeSourceLabel(source) {
  return NOTICE_SOURCES.find((item) => item.source === source)?.label || source || null
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDetailText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseBoardDate(value) {
  const match = normalizeWhitespace(value).match(/^(\d{4})[.-](\d{2})[.-](\d{2})/)
  if (!match) return null
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00+09:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function absoluteUrl(origin, href) {
  try {
    return new URL(href, origin).toString()
  } catch {
    return null
  }
}

function externalIdFromUrl(url, parameter) {
  try {
    return new URL(url).searchParams.get(parameter)
  } catch {
    return null
  }
}

function createNotice({ source, title, content, postedDate, sourceUrl, externalId, now }) {
  return {
    title: normalizeWhitespace(title).slice(0, 500),
    content: String(content || title).trim(),
    language: source.language,
    posted_date: postedDate.toISOString(),
    source: source.source,
    source_url: sourceUrl,
    external_id: externalId || null,
    scraped_at: now.toISOString(),
    _postedMs: postedDate.getTime(),
  }
}

function parseK2WebListPage(html, source, { now = new Date() } = {}) {
  const $ = cheerio.load(html)
  const items = []

  $('table.board-table tbody tr').each((_, tr) => {
    const anchor = $(tr).find('a[href*=artclView]').first()
    if (!anchor.length) return

    const href = anchor.attr('href')
    const title = normalizeWhitespace(anchor.text())
      .replace(/\s*\uC0C8\uAE00\s*$/u, '')
      .trim()
    if (!href || !title) return

    const cells = $(tr)
      .find('td')
      .map((__, td) => normalizeWhitespace($(td).text()))
      .get()
    const dateText = cells.find((cell) => /^\d{4}\.\d{2}\.\d{2}$/.test(cell))
    const postedDate = parseBoardDate(dateText)
    const sourceUrl = absoluteUrl(source.origin, href)
    if (!postedDate || !sourceUrl) return

    const badge = cells[0] && !/^\d+$/.test(cells[0]) ? cells[0] : null
    const externalMatch = href.match(/\/(\d+)\/artclView\.do/)
    items.push(createNotice({
      source,
      title,
      content: [badge ? `[${badge}]` : null, title, `Source: ${source.label}`]
        .filter(Boolean)
        .join('\n'),
      postedDate,
      sourceUrl,
      externalId: externalMatch ? externalMatch[1] : null,
      now,
    }))
  })

  return items
}

function parseMainPnuListPage(html, source, { now = new Date() } = {}) {
  const $ = cheerio.load(html)
  const items = []

  $('table tbody tr').each((_, tr) => {
    const anchor = $(tr).find('td.subject a[href*=board_seq]').first()
    if (!anchor.length) return
    const href = anchor.attr('href')
    const sourceUrl = absoluteUrl(source.listUrl, href)
    const postedDate = parseBoardDate($(tr).find('td.date').text())
    if (!sourceUrl || !postedDate) return

    const attachmentAlt = $(tr).find('img.isFileIcon').attr('alt') || ''
    const fullTitleMatch = attachmentAlt.match(/^'(.+)'\uC758\s/)
    const title = normalizeWhitespace(
      fullTitleMatch ? fullTitleMatch[1] : anchor.attr('title') || anchor.text(),
    )
    if (!title) return

    const writer = normalizeWhitespace($(tr).find('td.writer').text())
    items.push(createNotice({
      source,
      title,
      content: [writer ? `[${writer}]` : null, title, `Source: ${source.label}`]
        .filter(Boolean)
        .join('\n'),
      postedDate,
      sourceUrl,
      externalId: externalIdFromUrl(sourceUrl, 'board_seq'),
      now,
    }))
  })

  return items
}

function parseOneStopHomePage(html, source, { now = new Date() } = {}) {
  const $ = cheerio.load(html)
  const items = []

  $('#board-tabpanel-1 li.board-item').each((_, item) => {
    const anchor = $(item).find('a.board-link').first()
    const href = anchor.attr('href') || ''
    const match = href.match(/openBbsDetailPop\('([^']+)'\s*,\s*'(\d+)'/)
    if (!match) return

    const titleNode = anchor.find('.board-title').clone()
    titleNode.find('img, .icon-new').remove()
    const title = normalizeWhitespace(titleNode.text())
    const postedDate = parseBoardDate(anchor.find('time.item-date').attr('datetime'))
    if (!title || !postedDate) return

    const sourceUrl = `${source.origin}/page?menuCD=${encodeURIComponent(match[1])}&mode=DETAIL&seq=${encodeURIComponent(match[2])}`
    items.push(createNotice({
      source,
      title,
      content: `${title}\nSource: ${source.label}`,
      postedDate,
      sourceUrl,
      externalId: `${match[1]}:${match[2]}`,
      now,
    }))
  })

  return items
}

function readableElementText($, element) {
  const content = $(element).clone()
  content.find('script, style, noscript, iframe, button').remove()
  content.find('br').replaceWith('\n')
  content.find('p, li, tr, blockquote, h1, h2, h3, h4').each((_, node) => {
    $(node).append('\n')
  })
  return normalizeDetailText(content.text())
}

function parseNoticeDetailPage(html, source) {
  const $ = cheerio.load(html)
  const selectors = source.kind === 'k2web'
    ? ['.board-view .txt', '.viewCont .txt', '.artclView .txt', '.txt']
    : source.kind === 'main-cms'
      ? ['.board-view-contents', '.board-view-cont']
      : source.kind === 'onestop-home'
        ? ['.board-view-cont']
        : []

  for (const selector of selectors) {
    const element = $(selector).first()
    if (!element.length) continue
    const text = readableElementText($, element)
    if (text.length >= 20) return text
  }
  return null
}

function decodeDormitoryContent(value) {
  let text = cheerio.load(`<div>${value || ''}</div>`)('div').text()
  if (/<[^>]+>/.test(text)) {
    text = cheerio.load(`<div>${text}</div>`)('div').text()
  }
  return normalizeWhitespace(text)
}

function parseDormitoryRows(rows, source, { now = new Date() } = {}) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const title = normalizeWhitespace(row.TITLE_CONTENT)
    const postedDate = parseBoardDate(row.INS_DT)
    const sequence = row.POSTING_SEQ_NO
    if (!title || !postedDate || !sequence) return []

    const category = normalizeWhitespace(row.CATE_TYPE_KOR_NM || row.CATE_TYPE_NM)
    const detail = decodeDormitoryContent(row.CONTENT)
    const categoryQuery = row.CATE_TYPE_SEQ_NO
      ? `&cateSeq=${encodeURIComponent(row.CATE_TYPE_SEQ_NO)}`
      : ''
    const sourceUrl = `${source.listUrl}&mode=DETAIL&seq=${encodeURIComponent(sequence)}${categoryQuery}`

    return [createNotice({
      source,
      title,
      content: [category ? `[${category}]` : null, detail || title, `Source: ${source.label}`]
        .filter(Boolean)
        .join('\n'),
      postedDate,
      sourceUrl,
      externalId: String(sequence),
      now,
    })]
  })
}

async function fetchHtml(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Notice board fetch failed (${response.status}): ${url}`)
  }
  return response.text()
}

function pageUrl(source, page) {
  const url = new URL(source.listUrl)
  if (page > 1) url.searchParams.set('page', String(page))
  if (source.kind === 'main-cms') url.searchParams.set('robot', 'Y')
  return url.toString()
}

function parseSourcePage(html, source, options) {
  if (source.kind === 'k2web') return parseK2WebListPage(html, source, options)
  if (source.kind === 'main-cms') return parseMainPnuListPage(html, source, options)
  if (source.kind === 'onestop-home') return parseOneStopHomePage(html, source, options)
  throw new Error(`Unsupported notice source kind: ${source.kind}`)
}

async function scrapePagedSource(source, {
  sinceMs = Date.now() - ONE_MONTH_MS,
  fetchImpl = fetch,
  now = new Date(),
  onDetailError,
} = {}) {
  const byUrl = new Map()
  let reachedOlder = false

  for (let page = 1; page <= (source.maxPages || 1); page += 1) {
    const html = await fetchHtml(pageUrl(source, page), { fetchImpl })
    const items = parseSourcePage(html, source, { now })
    if (items.length === 0) break

    let freshOnPage = 0
    for (const item of items) {
      if (item._postedMs < sinceMs) {
        reachedOlder = true
        continue
      }
      freshOnPage += 1
      if (!byUrl.has(item.source_url)) byUrl.set(item.source_url, item)
    }
    if (freshOnPage === 0 && (reachedOlder || page > 1)) break
  }

  const items = [...byUrl.values()]
  let nextIndex = 0
  const workerCount = Math.min(4, items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      try {
        const detailHtml = await fetchHtml(item.source_url, { fetchImpl })
        const detailText = parseNoticeDetailPage(detailHtml, source)
        if (detailText) item.content = detailText
      } catch (error) {
        // Keep the list-page fallback for an individual unavailable detail.
        // One broken post must not hide the rest of a healthy notice board.
        if (typeof onDetailError === 'function') {
          onDetailError(source, item, error)
        }
      }
    }
  }))

  return items
}

function base64UrlFromHex(hex) {
  const normalized = hex.length % 2 ? `0${hex}` : hex
  return Buffer.from(normalized, 'hex').toString('base64url')
}

function encryptDormitoryPayload(value, modulus, exponent) {
  const key = createPublicKey({
    key: {
      kty: 'RSA',
      n: base64UrlFromHex(modulus),
      e: base64UrlFromHex(exponent),
    },
    format: 'jwk',
  })
  return publicEncrypt(
    { key, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(value, 'utf8'),
  ).toString('hex')
}

function requiredPageValue(html, pattern, label) {
  const match = html.match(pattern)
  if (!match) throw new Error(`Dormitory page is missing ${label}`)
  return match[1]
}

async function postDormitoryJson(session, path, payload, authString = null) {
  const inner = { _data: JSON.stringify(payload) }
  if (authString) inner.AUTH_STR = authString
  const body = JSON.stringify({
    _data: encryptDormitoryPayload(
      JSON.stringify(inner),
      session.modulus,
      session.exponent,
    ),
  })
  const response = await session.fetchImpl(`${session.source.origin}${path}`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/json',
      AJAX: 'true',
      'X-CSRF-TOKEN': session.token,
      Cookie: session.cookie,
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Dormitory notice API failed (${response.status}): ${path}`)
  }
  const result = await response.json()
  if (result.statusCode && result.statusCode !== 200) {
    throw new Error(result.errorMsg || result.msg || `Dormitory API status ${result.statusCode}`)
  }
  return result
}

async function createDormitorySession(source, fetchImpl) {
  const response = await fetchImpl(source.listUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Dormitory notice page failed (${response.status})`)
  }
  const html = await response.text()
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || '']
  const cookie = setCookies
    .map((value) => value.split(';')[0])
    .filter(Boolean)
    .join('; ')

  return {
    source,
    fetchImpl,
    cookie,
    token: requiredPageValue(html, /scwin\.token\s*=\s*\x22([^\x22]+)\x22/, 'CSRF token'),
    modulus: requiredPageValue(html, /RSAModulus\s*=\s*'([^']+)'/, 'RSA modulus'),
    exponent: requiredPageValue(html, /RSAExponent\s*=\s*'([^']+)'/, 'RSA exponent'),
  }
}

async function scrapeDormitorySource(source, {
  sinceMs = Date.now() - ONE_MONTH_MS,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const session = await createDormitorySession(source, fetchImpl)
  const info = await postDormitoryJson(session, '/pdorm/global/info', {
    menuCD: source.menuCode,
  })
  const menu = (info._Menu || []).find((item) => item.MENU_CD === source.menuCode)
  if (!menu || !menu.AUTH_STR) {
    throw new Error('Dormitory notice menu authorization metadata is missing')
  }
  const list = await postDormitoryJson(
    session,
    '/core/bbs/selectList',
    DORMITORY_LIST_REQUEST,
    menu.AUTH_STR,
  )
  return parseDormitoryRows(list.data, source, { now })
    .filter((item) => item._postedMs >= sinceMs)
}

async function scrapeSource(source, options = {}) {
  if (source.kind === 'dormitory-api') {
    return scrapeDormitorySource(source, options)
  }
  return scrapePagedSource(source, options)
}

async function scrapeRecentNotices(options = {}) {
  const sinceMs = options.sinceMs ?? Date.now() - ONE_MONTH_MS
  const sources = options.sources ?? options.boards ?? NOTICE_SOURCES
  const all = []
  const failures = []
  let successfulSources = 0

  for (const source of sources) {
    try {
      const items = await scrapeSource(source, {
        sinceMs,
        fetchImpl: options.fetchImpl,
        now: options.now,
        onDetailError: options.onDetailError,
      })
      successfulSources += 1
      all.push(...items)
      // Reported even on success, and even when the count is zero. A board
      // whose markup changed still returns HTTP 200 — the selectors simply
      // match nothing — so "no error" and "no notices" look identical from
      // here. Only the caller knows whether this board has produced notices
      // before, which is what separates a quiet board from a broken parser.
      if (typeof options.onSourceResult === 'function') {
        options.onSourceResult(source, { count: items.length, error: null })
      }
    } catch (error) {
      failures.push({ source: source.source, error })
      if (typeof options.onSourceResult === 'function') {
        options.onSourceResult(source, { count: 0, error })
      }
      if (typeof options.onSourceError === 'function') {
        options.onSourceError(source, error)
      } else {
        console.warn(`Notice source ${source.source} failed: ${error.message}`)
      }
    }
  }

  if (successfulSources === 0) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      'All configured notice sources failed',
    )
  }

  const byUrl = new Map()
  for (const item of all) {
    if (!byUrl.has(item.source_url)) byUrl.set(item.source_url, item)
  }
  return [...byUrl.values()]
    .sort((a, b) => b._postedMs - a._postedMs || a.source_url.localeCompare(b.source_url))
    .map(({ _postedMs, ...row }) => row)
}

function mapNoticeRow(row) {
  const source = row.source || null
  const text = `${row.title || ''} ${row.content || ''}`
  const scholarship = /\uC7A5\uD559|scholarship/i.test(text)
  const channel = scholarship
    ? 'scholarship'
    : source === 'international'
      ? 'international'
      : source === 'cse'
        ? 'department'
        : 'general'
  return {
    id: String(row.notice_id),
    title: row.title,
    body: row.content,
    date: row.posted_date,
    category: 'GENERAL',
    priority: 'NORMAL',
    source: noticeSourceLabel(source),
    channel,
    sourceUrl: row.source_url || null,
    read: false,
  }
}

module.exports = {
  BOARDS,
  DORMITORY_LIST_REQUEST,
  NOTICE_SOURCES,
  ONE_MONTH_MS,
  mapNoticeRow,
  noticeSourceLabel,
  parseDormitoryRows,
  parseK2WebListPage,
  parseMainPnuListPage,
  parseNoticeDetailPage,
  parseOneStopHomePage,
  scrapeDormitorySource,
  scrapeRecentNotices,
  scrapeSource,
}
