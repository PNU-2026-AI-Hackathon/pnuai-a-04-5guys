const {
  buildGraduationProgress,
  earnedCreditsForEnrollment,
} = require('../services/graduationProgressService');

describe('graduation progress enrollment synchronization', () => {
  test('uses earned credits and keeps pending or failing grades out of progress', () => {
    expect(earnedCreditsForEnrollment({ credit: 3, final_grade: null })).toBe(0);
    expect(earnedCreditsForEnrollment({ credit: 3, final_grade: 'F' })).toBe(0);
    expect(earnedCreditsForEnrollment({ credit: 3, final_grade: 'A0' })).toBe(3);
    expect(earnedCreditsForEnrollment({ credit: 3, final_grade: 'A0', credits_earned: 2 })).toBe(2);
  });

  test('syncs completed credits into the correct graduation buckets', () => {
    const progress = buildGraduationProgress({
      studentMajorId: 10,
      enrollments: [
        { status: 'Completed', category: 'MAJOR_REQUIRED', course_major_id: 10, credit: 3, final_grade: 'A0' },
        { status: 'Completed', category: 'MAJOR_ELECTIVE', course_major_id: 20, credit: 3, final_grade: 'B+' },
        { status: 'Completed', category: 'GEN_ED', credit: 2, final_grade: 'P' },
        { status: 'Completed', category: 'MAJOR_REQUIRED', course_major_id: 10, credit: 3, final_grade: 'F' },
        { status: 'Completed', category: 'MAJOR_REQUIRED', course_major_id: 10, credit: 3, final_grade: null },
      ],
    });

    expect(progress.totalCompleted).toBe(8);
    expect(progress.breakdown.majorRequired.completed).toBe(3);
    expect(progress.breakdown.generalElective.completed).toBe(2);
    expect(progress.breakdown.generalFree.completed).toBe(3);
  });
});
