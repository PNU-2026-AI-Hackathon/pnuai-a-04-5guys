jest.mock('../supabaseClient', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../services/geminiService', () => ({ translatePrograms: jest.fn() }));
jest.mock('../ai/programRecommendationEngine', () => ({ recommendPrograms: jest.fn() }));

const supabase = require('../supabaseClient');
const { recommendPrograms } = require('../ai/programRecommendationEngine');
const { rankPrograms } = require('../services/extracurricularProgramService');

function tableQuery(rows) {
  return {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: rows, error: null }),
  };
}

describe('extracurricular catalogue ranking', () => {
  beforeEach(() => jest.clearAllMocks());

  test('keeps unranked open programs after AI-ranked matches', async () => {
    const rows = [
      { program_id: 1, name: 'Ranked', category: 'Career', deadline: '2099-02-01' },
      { program_id: 2, name: 'Previously added', category: 'Culture', deadline: '2020-01-01' },
      { program_id: 3, name: 'Another program', category: 'Competition', deadline: null },
    ];
    supabase.from.mockReturnValue(tableQuery(rows));
    recommendPrograms.mockReturnValue([{
      id: '1', title: 'Ranked', date: '2099-02-01', score: 40, matchHint: 'Interest match', _row: rows[0],
    }]);

    const result = await rankPrograms({ limit: 200 });

    expect(result.map((program) => program.id)).toEqual(expect.arrayContaining(['1', '2', '3']));
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('1');
    expect(result[0]).toMatchObject({ score: 40, matchHint: 'Interest match' });
    expect(result.find((program) => program.id === '2')).toMatchObject({ score: 0, matchHint: '' });
    expect(recommendPrograms.mock.calls[0][1].map((program) => program.id)).not.toContain('2');
  });
});
