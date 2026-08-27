import type {
  CourseLanguageFilter,
  CourseSortKey,
  RecommendedCourse,
  SortDirection,
} from '@/types/api'

export function matchesCourseLanguage(
  course: RecommendedCourse,
  filter: CourseLanguageFilter,
): boolean {
  if (filter === 'ALL') return true
  if (filter === 'ENGLISH') return course.isEnglishTaught === true
  if (filter === 'UNKNOWN') {
    return course.isEnglishTaught == null && !course.teachingLanguage && !course.originalLanguageCode
  }
  if (filter === 'OTHER') {
    return course.teachingLanguage === 'OTHER'
      || ['C', 'J', 'F', 'G', 'R'].includes(String(course.originalLanguageCode || '').toUpperCase())
  }
  return course.teachingLanguage === filter
}

export function filterAndSortCourses<T extends RecommendedCourse>(
  courses: T[],
  language: CourseLanguageFilter,
  sortBy: CourseSortKey,
  direction: SortDirection,
): T[] {
  const multiplier = direction === 'DESC' ? -1 : 1
  return courses
    .filter((course) => matchesCourseLanguage(course, language))
    .sort((a, b) => {
      let comparison: number
      if (sortBy === 'RELEVANCE') comparison = Number(a.score || 0) - Number(b.score || 0)
      else if (sortBy === 'CREDITS') comparison = Number(a.credits || 0) - Number(b.credits || 0)
      else if (sortBy === 'CODE') comparison = String(a.officialCourseNumber || '').localeCompare(String(b.officialCourseNumber || ''))
      else comparison = String(a.nameEn || a.nameKo).localeCompare(String(b.nameEn || b.nameKo))
      return comparison * multiplier || String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
    })
}
