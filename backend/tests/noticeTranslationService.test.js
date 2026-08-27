process.env.OPENROUTER_API_KEY = 'test-key';

const calls = [];
async function defaultFetchImpl(url, opts) {
  calls.push(url);
  const body = JSON.parse(opts.body);
  const prompt = body.messages[0].content;
  const list = JSON.parse(prompt.split('Notices:')[1].trim());
  const translations = {};
  list.forEach((item) => {
    translations[item.id] = {
      title: `EN::${item.title}`,
      body: `EN::${item.body}`,
    };
  });
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ translations }) } }],
    }),
  };
}
global.fetch = jest.fn(defaultFetchImpl);

const { translateNotices } = require('../services/noticeTranslationService');

const notices = [
  { id: '1', title: '[교수학습지원센터] 연구조교 모집', body: '2026-2학기 연구조교를 모집합니다.', date: '2026-08-24' },
  { id: '2', title: '장학금 안내', body: '국제학생 장학금 신청 안내입니다.', date: '2026-08-23' },
];

beforeEach(() => {
  calls.length = 0;
  global.fetch.mockImplementation(defaultFetchImpl);
});

test('ko target returns notices unchanged with no AI call', async () => {
  const result = await translateNotices(notices, 'ko');
  expect(result).toBe(notices);
  expect(calls.length).toBe(0);
});

test('translates title and body for the requested language', async () => {
  const result = await translateNotices(notices, 'en');
  expect(calls.length).toBe(1);
  expect(result[0].title).toBe('EN::[교수학습지원센터] 연구조교 모집');
  expect(result[0].body).toBe('EN::2026-2학기 연구조교를 모집합니다.');
  expect(result[1].title).toBe('EN::장학금 안내');
  expect(result[0].originalTitle).toBe(notices[0].title);
  expect(result[0].originalBody).toBe(notices[0].body);
  expect(result[0].translationLanguage).toBe('en');
  // Untranslated fields pass through
  expect(result[0].date).toBe('2026-08-24');
});

test('same language is cached after the first call', async () => {
  await translateNotices(notices, 'en');
  calls.length = 0;

  const result = await translateNotices(notices, 'en');
  expect(calls.length).toBe(0);
  expect(result[0].title).toBe('EN::[교수학습지원센터] 연구조교 모집');
  expect(result[0].translationLanguage).toBe('en');
});

test('a failed AI call falls back to the original text instead of throwing', async () => {
  global.fetch.mockImplementation(async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    text: async () => 'boom',
  }));

  const result = await translateNotices(
    [{ id: '99', title: '공지', body: '내용' }],
    'zh',
  );
  expect(result[0].title).toBe('공지');
  expect(result[0].body).toBe('내용');
});

test('original notices are returned unmodified (no mutation)', async () => {
  const copy = JSON.parse(JSON.stringify(notices));
  await translateNotices(notices, 'vi');
  expect(notices).toEqual(copy);
});
