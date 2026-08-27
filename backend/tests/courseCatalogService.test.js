const {
  filterCourses,
  filterCoursesByOffering,
  filterCoursesByLanguage,
  sortCourses,
  findOfficialOffering,
  mapOffering,
} = require('../services/courseCatalogService');
const {
  attachCourseCurriculum,
  chooseCurriculumRow,
} = require('../ai/supabaseDataRepository');
const officialCourseProvenance = require('../config/pnu-course-provenance-2026-2.json');
const { parseOfferingSchedule } = require('../services/timetableService');

function course(overrides = {}) {
  return {
    id: '10',
    nameKo: '경영학원론',
    nameEn: 'Principles of Management',
    title: 'Principles of Management',
    officialCourseNumber: 'EC1500015',
    majorId: '73',
    department: 'Business Administration',
    type: 'REQUIRED',
    year: 1,
    curriculumYears: [2024, 2026],
    curriculum: { sourceCourseCode: 'DB1600346' },
    ...overrides,
  };
}

describe('course catalog curriculum mapping', () => {
  test('chooses exact curriculum year, then latest earlier reviewed year', () => {
    const rows = [
      { curriculum_year: 2023 },
      { curriculum_year: 2024 },
      { curriculum_year: 2026 },
    ];
    expect(chooseCurriculumRow(rows, 2024).curriculum_year).toBe(2024);
    expect(chooseCurriculumRow(rows, 2025).curriculum_year).toBe(2024);
  });

  test('overlays major-specific curriculum category, year, and source code', () => {
    const attached = attachCourseCurriculum([course({ type: 'ELECTIVE', year: 4 })], [{
      course_id: 10,
      curriculum_year: 2026,
      source_course_code: 'DB1600346',
      category: 'REQUIRED',
      recommended_year: 1,
      grade_semester: '1-1',
    }], { curriculumYear: 2026 });
    expect(attached[0]).toMatchObject({
      type: 'REQUIRED',
      year: 1,
      curriculumYears: [2026],
      curriculum: {
        curriculumYear: 2026,
        sourceCourseCode: 'DB1600346',
        gradeSemester: '1-1',
      },
    });
  });

  test('filters by name/code, major, category, year, and curriculum year', () => {
    const rows = [
      course(),
      course({
        id: '11',
        nameKo: '마케팅관리',
        nameEn: 'Marketing Management',
        officialCourseNumber: 'DB2000353',
        type: 'ELECTIVE',
        year: 2,
      }),
    ];
    expect(filterCourses(rows, {
      search: 'DB1600346',
      majorId: 73,
      category: 'REQUIRED',
      recommendedYear: 1,
      curriculumYear: 2026,
    })).toEqual([rows[0]]);
  });

  test('filters one exact course for the shared detail page', () => {
    const rows = [course(), course({ id: '11', nameEn: 'Marketing Management' })];
    expect(filterCourses(rows, { courseId: '11' })).toEqual([rows[1]]);
  });

  test('filters the complete catalog to courses with an official term offering', () => {
    const rows = [course(), course({ id: '11', nameEn: 'Marketing Management' })];
    expect(filterCoursesByOffering(rows, [{ course_id: 11 }], true)).toEqual([rows[1]]);
    expect(filterCoursesByOffering(rows, [{ course_id: 11 }], false)).toEqual(rows);
  });

  test('preserves verified offering capacity, remarks, and restrictions', () => {
    const offering = mapOffering({
      course_offering_id: 44,
      academic_year: 2026,
      semester: '2',
      enrollment_limit: 40,
      team_teaching_status: 'TEAM_TAUGHT',
      original_language_code: 'E',
      teaching_language: 'ENGLISH',
      general_education_area: null,
      remarks: 'International students may request permission.',
      schedule: null,
    }, null, [{
      course_offering_restriction_id: 7,
      source_kind: 'RESTRICTION',
      permission: 'PROHIBITED',
      department_condition: 'Other departments',
    }]);
    expect(offering).toMatchObject({
      enrollmentLimit: 40,
      teamTeachingStatus: 'TEAM_TAUGHT',
      originalLanguageCode: 'E',
      teachingLanguage: 'ENGLISH',
      isEnglishTaught: true,
      remarks: 'International students may request permission.',
      restrictions: [{ id: 7, permission: 'PROHIBITED', departmentCondition: 'Other departments' }],
    });
  });

  test('filters offering languages without treating missing metadata as Korean', () => {
    const rows = [
      course({ id: '1', teachingLanguage: 'ENGLISH', isEnglishTaught: true }),
      course({ id: '2', teachingLanguage: 'KOREAN', isEnglishTaught: false }),
      course({ id: '3', teachingLanguage: null, originalLanguageCode: null, isEnglishTaught: null }),
    ];
    expect(filterCoursesByLanguage(rows, 'ENGLISH')).toEqual([rows[0]]);
    expect(filterCoursesByLanguage(rows, 'KOREAN')).toEqual([rows[1]]);
    expect(filterCoursesByLanguage(rows, 'UNKNOWN')).toEqual([rows[2]]);
  });

  test('sorts deterministically by name, credits, or course code', () => {
    const rows = [
      course({ id: '2', nameEn: 'Beta', credits: 2, officialCourseNumber: 'B200' }),
      course({ id: '1', nameEn: 'Alpha', credits: 3, officialCourseNumber: 'A100' }),
    ];
    expect(sortCourses(rows, 'NAME', 'ASC').map((row) => row.id)).toEqual(['1', '2']);
    expect(sortCourses(rows, 'CREDITS', 'DESC').map((row) => row.id)).toEqual(['1', '2']);
    expect(sortCourses(rows, 'CODE', 'DESC').map((row) => row.id)).toEqual(['2', '1']);
  });

  test('uses the indexed official schedule when production has only a partial legacy time', () => {
    expect(findOfficialOffering({
      courseCode: 'CB1501019',
      section: '59',
    }, 2026, '2')).toMatchObject({
      professor: '이기준',
      schedule: '월 16:30(75) 102-306, 수 16:30(75) 102-306',
    });
  });

  test('every indexed official schedule can be converted into timetable slots', () => {
    expect(officialCourseProvenance.officialScheduleIndex.scheduledOfferingCount).toBe(3721);
    expect(officialCourseProvenance.officialScheduleIndex.offerings.every((offering) =>
      parseOfferingSchedule(offering.schedule, offering.classroom).length > 0)).toBe(true);
  });
});
