const {
  DORMITORY_LIST_REQUEST,
  NOTICE_SOURCES,
  mapNoticeRow,
  parseDormitoryRows,
  parseK2WebListPage,
  parseMainPnuListPage,
  parseNoticeDetailPage,
  parseOneStopHomePage,
  scrapeRecentNotices,
} = require('../services/pnuNoticeScraperService');

const now = new Date('2026-08-11T12:00:00.000Z');

function source(id) {
  return NOTICE_SOURCES.find((item) => item.source === id);
}

describe('real PNU notice source registry', () => {
  test('covers the five agreed public source families', () => {
    expect(NOTICE_SOURCES.map((item) => item.source)).toEqual([
      'pnu-main',
      'onestop',
      'international',
      'cse',
      'dormitory',
    ]);
    expect(new Set(NOTICE_SOURCES.map((item) => item.listUrl)).size).toBe(5);
    expect(DORMITORY_LIST_REQUEST).toEqual({ pageIndex: 0, pageSize: 100 });
  });

  test('parses K2Web notices with official identity and link', () => {
    const rows = parseK2WebListPage(`
      <table class='board-table'><tbody><tr>
        <td>Academic</td>
        <td><a href='/bbs/international/2081/1453077/artclView.do'>Residence application</a></td>
        <td>2026.08.11</td>
      </tr></tbody></table>
    `, source('international'), { now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Residence application',
      source: 'international',
      external_id: '1453077',
      source_url: 'https://international.pusan.ac.kr/bbs/international/2081/1453077/artclView.do',
    });
  });

  test('parses the main PNU CMS board', () => {
    const rows = parseMainPnuListPage(`
      <table><tbody><tr>
        <td class='subject'><a href='?mCode=MN095&mgr_seq=3&mode=view&board_seq=1510419'>Scholarship application</a></td>
        <td class='writer'>Student Affairs</td><td class='date'>2026-08-10</td>
      </tr></tbody></table>
    `, source('pnu-main'), { now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Scholarship application',
      source: 'pnu-main',
      external_id: '1510419',
    });
  });

  test('parses public One-Stop homepage notices without authentication', () => {
    const rows = parseOneStopHomePage(`
      <div id='board-tabpanel-1'><li class='board-item'>
        <a class='board-link' href=\x22javascript:openBbsDetailPop('000000000000386','2141','')\x22>
          <span class='board-title'>Graduate assistant recruitment</span>
          <time class='item-date' datetime='2026-08-11'></time>
        </a>
      </li></div>
    `, source('onestop'), { now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'onestop',
      external_id: '000000000000386:2141',
      source_url: 'https://onestop.pusan.ac.kr/page?menuCD=000000000000386&mode=DETAIL&seq=2141',
    });
  });

  test.each([
    ['international', `<div class="board-view"><div class="txt"><p>First requirement</p><p>Deadline: 2026-09-01</p></div></div>`, 'First requirement'],
    ['pnu-main', `<div class="board-view-contents"><p>Main notice body</p><p>Bring your student ID.</p></div>`, 'Main notice body'],
    ['onestop', `<div class="board-view-cont"><p>One-Stop notice body</p><p>Contact your department.</p></div>`, 'One-Stop notice body'],
  ])('extracts readable full text from %s detail pages', (sourceId, html, expected) => {
    const text = parseNoticeDetailPage(html, source(sourceId));
    expect(text).toContain(expected);
    expect(text).toMatch(/2026-09-01|student ID|department/);
    expect(text).not.toMatch(/<p>/);
  });

  test('normalizes public dormitory API rows', () => {
    const rows = parseDormitoryRows([{
      TITLE_CONTENT: 'Dormitory application',
      INS_DT: '2026-08-09 10:00:00',
      POSTING_SEQ_NO: 5298,
      CATE_TYPE_SEQ_NO: 1,
      CATE_TYPE_KOR_NM: 'Admissions',
      CONTENT: '&lt;p&gt;Application details&lt;/p&gt;',
    }], source('dormitory'), { now });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'dormitory',
      external_id: '5298',
    });
    expect(rows[0].content).toContain('Application details');
    expect(rows[0].source_url).toContain('mode=DETAIL&seq=5298');
  });
});

describe('multi-source failure isolation', () => {
  const goodHtml = `
    <div id='board-tabpanel-1'><li class='board-item'>
      <a class='board-link' href=\x22javascript:openBbsDetailPop('menu','7','')\x22>
        <span class='board-title'>Current notice</span>
        <time class='item-date' datetime='2026-08-11'></time>
      </a>
    </li></div>
  `;
  const good = { ...source('onestop'), source: 'good', listUrl: 'https://good.example/list' };
  const bad = { ...source('onestop'), source: 'bad', listUrl: 'https://bad.example/list' };

  test('returns successful sources when another source fails', async () => {
    const failures = [];
    const rows = await scrapeRecentNotices({
      sources: [bad, good],
      sinceMs: new Date('2026-08-01T00:00:00.000Z').getTime(),
      now,
      onSourceError: (failedSource) => failures.push(failedSource.source),
      fetchImpl: async (url) => {
        if (url.startsWith('https://bad.example')) throw new Error('offline');
        return { ok: true, status: 200, text: async () => goodHtml };
      },
    });
    expect(failures).toEqual(['bad']);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('good');
  });

  test('fails closed when every configured source fails', async () => {
    await expect(scrapeRecentNotices({
      sources: [bad],
      onSourceError: () => {},
      fetchImpl: async () => { throw new Error('offline'); },
    })).rejects.toThrow('All configured notice sources failed');
  });

  test('replaces list-page placeholder content with fetched detail text', async () => {
    const board = { ...source('cse'), maxPages: 1 };
    const listHtml = `
      <table class='board-table'><tbody><tr>
        <td>Academic</td>
        <td><a href='/bbs/cse/2055/99/artclView.do'>Detailed notice</a></td>
        <td>2026.08.11</td>
      </tr></tbody></table>
    `;
    const detailHtml = `
      <div class='board-view'><div class='txt'>
        <p>Complete application instructions.</p>
        <p>Submit documents by 2026-09-01.</p>
      </div></div>
    `;

    const rows = await scrapeRecentNotices({
      sources: [board],
      sinceMs: new Date('2026-08-01T00:00:00.000Z').getTime(),
      now,
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        text: async () => url.includes('artclView') ? detailHtml : listHtml,
      }),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('Complete application instructions.');
    expect(rows[0].content).toContain('2026-09-01');
    expect(rows[0].content).not.toContain('Source: CSE Department');
  });
});

test('maps official source labels and scholarship channel without changing priority', () => {
  expect(mapNoticeRow({
    notice_id: 1,
    title: 'Scholarship application',
    content: 'Official notice',
    source: 'pnu-main',
    source_url: 'https://www.pusan.ac.kr/notice/1',
  })).toMatchObject({
    source: 'PNU Main Notices',
    channel: 'scholarship',
    priority: 'NORMAL',
  });

  expect(mapNoticeRow({ notice_id: 2, source: 'onestop' })).toMatchObject({
    source: 'PNU Student Support',
    channel: 'general',
  });
  expect(mapNoticeRow({ notice_id: 3, source: 'dormitory' })).toMatchObject({
    source: 'PNU Dormitory',
    channel: 'general',
  });
});
