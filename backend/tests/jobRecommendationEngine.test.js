const { recommendJobs } = require('../ai/jobRecommendationEngine');

function job(id, overrides = {}) {
  return {
    id,
    title: `Job ${id}`,
    company: 'Acme Corp',
    role: null,
    deadline: '2026-09-30',
    jobType: 'internship',
    ...overrides,
  };
}

describe('Job recommendation engine', () => {
  test('ranks a matching-interest job above a non-matching one', () => {
    const profile = { interests: ['Data Science'], careerAreas: [], academicAreas: [] };
    const jobs = [
      job('1', { title: 'Marketing Assistant' }),
      job('2', { title: 'Data Science Intern' }),
    ];

    const recommended = recommendJobs(profile, jobs, { asOfDate: '2026-08-01' });

    expect(recommended[0].id).toBe('2');
    expect(recommended[0].matchReason).toContain('Data Science');
  });

  test('an expired posting is dropped entirely', () => {
    const profile = { interests: ['Data Science'] };
    const jobs = [job('1', { title: 'Data Science Intern', deadline: '2026-01-01' })];

    const recommended = recommendJobs(profile, jobs, { asOfDate: '2026-08-01' });

    expect(recommended).toHaveLength(0);
  });

  test('a near deadline boosts score even without a tag match', () => {
    const profile = { interests: [] };
    const jobs = [
      job('1', { title: 'Warehouse Associate', deadline: '2026-08-05' }),
      job('2', { title: 'Office Assistant', deadline: '2026-12-01' }),
    ];

    const recommended = recommendJobs(profile, jobs, { asOfDate: '2026-08-01', limit: 2 });

    expect(recommended[0].id).toBe('1');
    expect(recommended[0].matchReason).toMatch(/deadline/i);
  });

  test('falls back to soonest-deadline postings when nothing matches the profile', () => {
    const profile = {};
    const jobs = [
      job('1', { title: 'Role A', deadline: '2026-11-01' }),
      job('2', { title: 'Role B', deadline: '2026-09-01' }),
    ];

    const recommended = recommendJobs(profile, jobs, { asOfDate: '2026-08-01', limit: 5 });

    expect(recommended).toHaveLength(2);
    expect(recommended[0].id).toBe('2');
    expect(recommended.every((r) => r.matchReason)).toBe(true);
  });

  test('respects the limit option', () => {
    const profile = { interests: ['AI'] };
    const jobs = [
      job('1', { title: 'AI Research Intern' }),
      job('2', { title: 'AI Product Intern' }),
      job('3', { title: 'AI Platform Intern' }),
    ];

    const recommended = recommendJobs(profile, jobs, { asOfDate: '2026-08-01', limit: 2 });

    expect(recommended).toHaveLength(2);
  });
});
