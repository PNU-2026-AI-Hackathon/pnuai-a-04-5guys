const {
  attachCourseCurriculum,
  fetchAllCourses,
  fetchCourseCurriculum,
  fetchCourseMetadata,
  fetchCourseOfferings,
  explicitEnglishStatus,
} = require('../ai/supabaseDataRepository');
const { parseOfferingSchedule } = require('./timetableService');
const officialCourseProvenance = require('../config/pnu-course-provenance-2026-2.json');

function normalizeSection(value) {
  const normalized = String(value || '').trim().replace(/^0+/, '');
  return normalized || '0';
}

const officialOfferingByIdentity = new Map(
  (officialCourseProvenance.officialScheduleIndex?.offerings || []).map((row) => [
    `${row.officialCourseNumber}|${officialCourseProvenance.academicYear}|${officialCourseProvenance.semester}|${normalizeSection(row.section)}`,
    row,
  ]),
);

function findOfficialOffering(course, academicYear, semester) {
  const key = [
    course.courseCode,
    academicYear,
    semester,
    normalizeSection(course.section),
  ].join('|');
  return officialOfferingByIdentity.get(key) || null;
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function mapRestriction(row) {
  return {
    id: Number(row.course_offering_restriction_id),
    kind: row.source_kind,
    ruleType: row.source_rule_type || null,
    permission: row.permission || null,
    departmentCondition: row.department_condition || null,
    yearLevelCondition: row.year_level_condition || null,
    domesticForeignCondition: row.domestic_foreign_condition || null,
    nationalityCondition: row.nationality_condition || null,
    curriculumYearCondition: row.curriculum_year_condition || null,
    completedSemestersCondition: row.completed_semesters_condition || null,
    academicStatusCondition: row.academic_status_condition || null,
    degreeProgramCondition: row.degree_program_condition || null,
    reason: row.reason || null,
    exceptionText: row.exception_text || null,
  };
}

function mapOffering(row, metadata = null, restrictions = []) {
  const originalLanguageCode = row.original_language_code || null;
  const teachingLanguage = row.teaching_language || null;
  return {
    courseOfferingId: Number(row.course_offering_id),
    officialCourseNumber: row.official_course_number || null,
    academicYear: Number(row.academic_year),
    semester: String(row.semester),
    section: row.section || null,
    professor: row.professor || null,
    schedule: row.schedule || null,
    classroom: row.classroom || null,
    originalLanguageCode,
    teachingLanguage,
    isEnglishTaught: explicitEnglishStatus(originalLanguageCode, teachingLanguage),
    remoteCourseStatus: row.remote_course_status || null,
    theoryHours: row.theory_hours == null ? null : Number(row.theory_hours),
    practicalHours: row.practical_hours == null ? null : Number(row.practical_hours),
    enrollmentLimit: row.enrollment_limit == null ? null : Number(row.enrollment_limit),
    teamTeachingStatus: row.team_teaching_status || null,
    generalEducationArea: row.general_education_area || null,
    remarks: row.remarks || null,
    restrictions: restrictions.map(mapRestriction),
    slots: parseOfferingSchedule(row.schedule, row.classroom),
    presentationRequirement: metadata?.presentation_requirement || null,
    groupProjectRequirement: metadata?.group_project_requirement || null,
    assignmentRequirement: metadata?.assignment_requirement || null,
    examInformation: metadata?.exam_information || null,
  };
}

function isMissingOptionalRelation(error) {
  return ['PGRST205', '42P01', '42703'].includes(error?.code)
    || /could not find|does not exist|schema cache/i.test(error?.message || '');
}

async function fetchOfferingRestrictions(supabase, offeringIds) {
  if (!offeringIds.length) return [];
  const { data, error } = await supabase
    .from('course_offering_restriction')
    .select(`
      course_offering_restriction_id,course_offering_id,source_kind,
      source_rule_type,permission,department_condition,year_level_condition,
      domestic_foreign_condition,nationality_condition,curriculum_year_condition,
      completed_semesters_condition,academic_status_condition,
      degree_program_condition,reason,exception_text
    `)
    .in('course_offering_id', offeringIds)
    .order('course_offering_restriction_id', { ascending: true });
  if (error) {
    if (isMissingOptionalRelation(error)) return [];
    const failure = new Error(`Failed to fetch course restrictions: ${error.message}`);
    failure.statusCode = 502;
    failure.code = 'SUPABASE_COURSE_RESTRICTION_QUERY_FAILED';
    throw failure;
  }
  return data || [];
}

async function fetchCourseSourceDetails(supabase, courseIds) {
  if (!courseIds.length) return { details: [], prerequisites: [] };
  const [detailResult, prerequisiteResult] = await Promise.all([
    supabase
      .from('course_source_detail')
      .select('course_id,description_ko,description_en,source_url,syllabus_url,source_kind,retrieved_at')
      .in('course_id', courseIds),
    supabase
      .from('course_prerequisite')
      .select(`
        course_prerequisite_id,course_id,prerequisite_course_id,
        requirement_text,source_url,source_kind,
        prerequisite:prerequisite_course_id(course_id,course_name,course_name_en,official_course_number)
      `)
      .in('course_id', courseIds)
      .order('course_prerequisite_id', { ascending: true }),
  ]);
  const nonOptionalError = [detailResult.error, prerequisiteResult.error]
    .find((error) => error && !isMissingOptionalRelation(error));
  if (nonOptionalError) {
    const failure = new Error(`Failed to fetch sourced course details: ${nonOptionalError.message}`);
    failure.statusCode = 502;
    failure.code = 'SUPABASE_COURSE_DETAIL_QUERY_FAILED';
    throw failure;
  }
  return {
    details: detailResult.error ? [] : (detailResult.data || []),
    prerequisites: prerequisiteResult.error ? [] : (prerequisiteResult.data || []),
  };
}

async function fetchMajors(supabase) {
  const { data, error } = await supabase
    .from('major')
    .select('major_id,major_name,department,college_id')
    .order('major_id', { ascending: true });
  if (error) {
    const failure = new Error(`Failed to fetch majors: ${error.message}`);
    failure.statusCode = 502;
    failure.code = 'SUPABASE_MAJOR_QUERY_FAILED';
    throw failure;
  }
  return data || [];
}

function filterCourses(courses, filters) {
  const search = normalizeText(filters.search);
  const category = String(filters.category || '').toUpperCase();
  const majorIds = Array.isArray(filters.majorId)
    ? filters.majorId.map(id => String(id))
    : (filters.majorId == null || filters.majorId === '' ? null : [String(filters.majorId)]);
  const recommendedYear = Number(filters.recommendedYear);
  const curriculumYear = Number(filters.curriculumYear);
  const courseId = filters.courseId == null || filters.courseId === ''
    ? null
    : String(filters.courseId);
  return courses.filter((course) => {
    if (courseId && String(course.id) !== courseId) return false;
    if (majorIds) {
      const courseMajors = course.majorIds || (course.majorId ? [String(course.majorId)] : []);
      if (!courseMajors.some(id => majorIds.includes(String(id)))) return false;
    }
    if (category && category !== 'ALL') {
      const type = String(course.type).toUpperCase();
      if (category === '전공') {
        if (!['전공기초', '전공필수', '전공선택'].includes(type)) return false;
      } else if (type !== category) {
        return false;
      }
    }
    if (Number.isInteger(recommendedYear) && Number(course.year) !== recommendedYear) return false;
    if (Number.isInteger(curriculumYear)
      && !course.curriculumYears.includes(curriculumYear)) return false;
    if (!search) return true;
    return [
      course.nameKo,
      course.nameEn,
      course.title,
      course.officialCourseNumber,
      course.curriculum?.sourceCourseCode,
      course.department,
    ].some((value) => normalizeText(value).includes(search));
  });
}

function filterCoursesByOffering(courses, offeringRows, offeredOnly) {
  if (!offeredOnly) return courses;
  const offeredCourseIds = new Set(
    (offeringRows || []).map((row) => String(row.course_id)),
  );
  return courses.filter((course) => offeredCourseIds.has(String(course.id)));
}

function filterCoursesByLanguage(courses, languageFilter) {
  const filter = String(languageFilter || 'ALL').toUpperCase();
  if (filter === 'ALL') return courses;
  return courses.filter((course) => {
    if (filter === 'ENGLISH') return course.isEnglishTaught === true;
    if (filter === 'UNKNOWN') {
      return course.isEnglishTaught == null && !course.teachingLanguage && !course.originalLanguageCode;
    }
    if (filter === 'OTHER') {
      return course.teachingLanguage === 'OTHER'
        || ['C', 'J', 'F', 'G', 'R'].includes(String(course.originalLanguageCode || '').toUpperCase());
    }
    return String(course.teachingLanguage || '').toUpperCase() === filter;
  });
}

function sortCourses(courses, sortBy, sortDirection) {
  const field = String(sortBy || 'NAME').toUpperCase();
  const direction = String(sortDirection || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
  return [...courses].sort((a, b) => {
    let comparison = 0;
    if (field === 'CREDITS') comparison = Number(a.credits || 0) - Number(b.credits || 0);
    else if (field === 'CODE') comparison = String(a.officialCourseNumber || '').localeCompare(String(b.officialCourseNumber || ''));
    else comparison = String(a.nameEn || a.nameKo).localeCompare(String(b.nameEn || b.nameKo));
    return comparison * direction || Number(a.id) - Number(b.id);
  });
}

async function listCourseCatalog(supabase, options = {}) {
  const page = positiveInteger(options.page, 1);
  const pageSize = positiveInteger(options.pageSize, 50, 100);
  const preferredCurriculumYear = Number(options.curriculumYear);
  const [baseCourses, curriculumRows, majors, offeringRows] = await Promise.all([
    fetchAllCourses(supabase, {
      language: options.language || 'en',
      courseId: options.courseId,
    }),
    fetchCourseCurriculum(supabase, {
      majorId: options.majorId == null || options.majorId === '' ? undefined : options.majorId,
    }),
    fetchMajors(supabase),
    fetchCourseOfferings(supabase, {
      academicYear: Number(options.academicYear),
      semester: String(options.semester),
    }).catch((error) => {
      if (error?.code === 'OPTIONAL_COURSE_OFFERING_QUERY_FAILED') return [];
      throw error;
    }),
  ]);
  const majorById = new Map(majors.map((major) => [String(major.major_id), major]));
  const majorIdsByCourseId = new Map();
  const studentMajorIds = new Set(
    (Array.isArray(options.studentMajorIds) ? options.studentMajorIds : [])
      .map((id) => String(id)),
  );
  const offeringsByCourseId = new Map();
  for (const row of offeringRows || []) {
    const courseId = String(row.course_id);
    if (!offeringsByCourseId.has(courseId)) offeringsByCourseId.set(courseId, []);
    offeringsByCourseId.get(courseId).push(row);
  }
  for (const row of curriculumRows || []) {
    if (row.major_id == null) continue;
    const courseId = String(row.course_id);
    if (!majorIdsByCourseId.has(courseId)) majorIdsByCourseId.set(courseId, new Set());
    majorIdsByCourseId.get(courseId).add(String(row.major_id));
  }

  let courses = attachCourseCurriculum(baseCourses, curriculumRows, {
    curriculumYear: Number.isInteger(preferredCurriculumYear)
      ? preferredCurriculumYear
      : undefined,
  }).map((course) => {
    const curriculumMajors = majorIdsByCourseId.get(String(course.id));
    
    const allMajorIds = new Set();
    if (course.majorId) allMajorIds.add(String(course.majorId));
    if (curriculumMajors) curriculumMajors.forEach(id => allMajorIds.add(id));
    const resolvedMajorId = course.majorId
      ?? (curriculumMajors && curriculumMajors.size > 0
        ? Array.from(curriculumMajors)[0]
        : null);
    const major = majorById.get(String(resolvedMajorId));
    return {
      ...course,
      majorId: resolvedMajorId,
      majorIds: Array.from(allMajorIds),
      majorName: major?.major_name || course.department || '',
      department: major?.department || course.department || major?.major_name || '',
      collegeId: major?.college_id == null ? null : Number(major.college_id),
      isInStudentMajor: studentMajorIds.size > 0
        ? Array.from(allMajorIds).some((id) => studentMajorIds.has(String(id)))
        : null,
      offerings: [],
      score: 0,
      matchHint: null,
    };
  });

  courses = filterCourses(courses, options);
  courses = courses.map(course => {
    const rows = offeringsByCourseId.get(String(course.id)) || [];
    const requestedSection = String(course.section || '').replace(/^0+/, '');
    const selectedRow = rows.find((row) =>
      String(row.section || '').replace(/^0+/, '') === requestedSection)
      || rows[0]
      || null;
    const officialOffering = selectedRow ? mapOffering(selectedRow) : null;
    const indexedOfficialOffering = findOfficialOffering(
      course,
      Number(options.academicYear),
      String(options.semester),
    );
    const legacySchedule = course.dayOfWeek && course.startTime && course.endTime
      ? `${course.dayOfWeek} ${course.startTime}-${course.endTime}`
      : null;
    const schedule = officialOffering?.schedule
      || indexedOfficialOffering?.schedule
      || legacySchedule;
    const classroom = officialOffering?.classroom
      || indexedOfficialOffering?.classroom
      || course.location
      || null;
    return {
      ...course,
      courseOfferingId: officialOffering?.courseOfferingId ?? null,
      officialCourseNumber: officialOffering?.officialCourseNumber || course.courseCode,
      academicYear: officialOffering?.academicYear ?? options.academicYear ?? 2026,
      semester: officialOffering?.semester ?? options.semester ?? '2',
      section: officialOffering?.section || course.section || null,
      professor: officialOffering?.professor || indexedOfficialOffering?.professor || course.professor || null,
      originalLanguageCode: officialOffering?.originalLanguageCode ?? course.originalLanguageCode ?? null,
      teachingLanguage: officialOffering?.teachingLanguage ?? course.teachingLanguage ?? null,
      isEnglishTaught: officialOffering?.isEnglishTaught ?? course.isEnglishTaught ?? null,
      remoteCourseStatus: officialOffering?.remoteCourseStatus ?? course.remoteCourseStatus ?? null,
      theoryHours: officialOffering?.theoryHours ?? course.theoryHours ?? null,
      practicalHours: officialOffering?.practicalHours ?? course.practicalHours ?? null,
      schedule,
      classroom,
      enrollmentLimit: officialOffering?.enrollmentLimit ?? null,
      restrictions: officialOffering?.restrictions || [],
      slots: officialOffering?.slots
        || parseOfferingSchedule(schedule, classroom),
      offerings: rows.map((row) => mapOffering(row)),
    };
  });

  courses = filterCoursesByLanguage(courses, options.languageFilter);
  courses = sortCourses(courses, options.sortBy, options.sortDirection);
  const total = courses.length;
  const offset = (page - 1) * pageSize;
  const items = courses.slice(offset, offset + pageSize);

  if (items.length) {
    const courseIds = items.map((course) => Number(course.id));
    const sourced = await fetchCourseSourceDetails(supabase, courseIds);
    const detailByCourseId = new Map(
      sourced.details.map((row) => [String(row.course_id), row]),
    );
    const prerequisiteByCourseId = new Map();
    for (const row of sourced.prerequisites) {
      const key = String(row.course_id);
      if (!prerequisiteByCourseId.has(key)) prerequisiteByCourseId.set(key, []);
      prerequisiteByCourseId.get(key).push({
        id: Number(row.course_prerequisite_id),
        courseId: row.prerequisite_course_id == null ? null : Number(row.prerequisite_course_id),
        officialCourseNumber: row.prerequisite?.official_course_number || null,
        nameKo: row.prerequisite?.course_name || null,
        nameEn: row.prerequisite?.course_name_en || null,
        requirementText: row.requirement_text || null,
        sourceUrl: row.source_url || null,
        sourceKind: row.source_kind,
      });
    }
    for (const course of items) {
      const detail = detailByCourseId.get(String(course.id));
      course.descriptionKo = detail?.description_ko || null;
      course.descriptionEn = detail?.description_en || null;
      course.descriptionSourceUrl = detail?.source_url || null;
      course.syllabusUrl = detail?.syllabus_url || null;
      course.detailSourceKind = detail?.source_kind || null;
      course.prerequisites = prerequisiteByCourseId.get(String(course.id)) || [];
    }
  }

  // Skip old metadata fetching since offerings are natively built from courses now

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    hasMore: offset + items.length < total,
  };
}

module.exports = {
  filterCourses,
  filterCoursesByOffering,
  filterCoursesByLanguage,
  sortCourses,
  fetchCourseSourceDetails,
  fetchOfferingRestrictions,
  isMissingOptionalRelation,
  listCourseCatalog,
  mapOffering,
  mapRestriction,
  findOfficialOffering,
  normalizeSection,
  normalizeText,
};
