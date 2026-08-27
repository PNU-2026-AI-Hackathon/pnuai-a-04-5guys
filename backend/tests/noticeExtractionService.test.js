process.env.OPENROUTER_API_KEY = 'test-key';

const calls = [];
async function defaultFetchImpl(url, opts) {
  const body = JSON.parse(opts.body);
  const prompt = body.messages[0].content;
  calls.push(prompt);
  const list = JSON.parse(prompt.split('Notices:')[1].trim());
  const extractions = {};
  list.forEach((item) => {
    extractions[item.id] = item.title.includes('장학금')
      ? { deadline: '2026-09-30', eligibility: '재학생', requiredDocuments: ['성적증명서'] }
      : { deadline: null, eligibility: null, requiredDocuments: [] };
  });
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ extractions }) } }],
    }),
  };
}
global.fetch = jest.fn(defaultFetchImpl);

const { extractNoticeInfo } = require('../services/noticeExtractionService');

beforeEach(() => {
  calls.length = 0;
  global.fetch.mockImplementation(defaultFetchImpl);
});

test('extracts deadline, eligibility, and documents when stated', async () => {
  const result = await extractNoticeInfo([
    { id: 'scholarship-1', title: '장학금 신청 안내', body: '재학생 대상 장학금 신청.', deadline: null },
  ]);
  expect(calls.length).toBe(1);
  expect(result[0].deadline).toBe('2026-09-30');
  expect(result[0].eligibility).toBe('재학생');
  expect(result[0].requiredDocuments).toEqual(['성적증명서']);
});

test('leaves null/[] when nothing is stated, does not invent values', async () => {
  const result = await extractNoticeInfo([
    { id: 'club-1', title: '동아리 모집', body: '신입 회원을 모집합니다.', deadline: null },
  ]);
  expect(result[0].deadline).toBeNull();
  expect(result[0].eligibility).toBeNull();
  expect(result[0].requiredDocuments).toEqual([]);
});

test('does not overwrite an already-known deadline', async () => {
  const result = await extractNoticeInfo([
    { id: 'scholarship-2', title: '장학금 신청 안내', body: '내용', deadline: '2026-01-01' },
  ]);
  expect(result[0].deadline).toBe('2026-01-01');
});

test('extracts from originalTitle/originalBody (the Korean source) rather than the translated title/body', async () => {
  const result = await extractNoticeInfo([
    {
      id: 'scholarship-3',
      title: 'Scholarship Application',
      body: 'For enrolled students.',
      originalTitle: '장학금 신청 안내',
      originalBody: '재학생 대상 장학금 신청.',
      deadline: null,
    },
  ]);
  expect(calls.length).toBe(1);
  expect(calls[0]).toContain('장학금 신청 안내');
  expect(calls[0]).not.toContain('Scholarship Application');
  expect(result[0].deadline).toBe('2026-09-30');
});

test('cached after the first call for the same notice id', async () => {
  const notice = { id: 'scholarship-4', title: '장학금 신청 안내', body: '재학생 대상 장학금 신청.', deadline: null };
  await extractNoticeInfo([notice]);
  calls.length = 0;

  const result = await extractNoticeInfo([notice]);
  expect(calls.length).toBe(0);
  expect(result[0].deadline).toBe('2026-09-30');
});

test('a failed AI call leaves fields null/[] instead of throwing', async () => {
  global.fetch.mockImplementation(async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    text: async () => 'boom',
  }));

  const result = await extractNoticeInfo([{ id: 'notice-99', title: '공지', body: '내용' }]);
  expect(result[0].deadline).toBeNull();
  expect(result[0].eligibility).toBeNull();
  expect(result[0].requiredDocuments).toEqual([]);
});
