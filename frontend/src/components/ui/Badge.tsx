import type { CourseType } from '@/types/api'

const styles: Partial<Record<CourseType, string>> & Record<string, string> = {
  '전공기초': 'bg-blue-50 text-blue-700 border-blue-200',
  '전공필수': 'bg-blue-50 text-blue-700 border-blue-200',
  '전공선택': 'bg-violet-50 text-violet-700 border-violet-200',
  '전공': 'bg-blue-50 text-blue-700 border-blue-200',
  '일반선택': 'bg-gray-50 text-gray-700 border-gray-200',
  '효원핵심교양': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '효원균형교양': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '효원창의교양': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '교직과목': 'bg-amber-50 text-amber-700 border-amber-200',
  '타전공': 'bg-rose-50 text-rose-700 border-rose-200',
}

const labels: Partial<Record<CourseType, string>> & Record<string, string> = {
  '전공기초': '전공기초',
  '전공필수': '전공필수',
  '전공선택': '전공선택',
  '전공': '전공',
  '일반선택': '일반선택',
  '효원핵심교양': '효원핵심교양',
  '효원균형교양': '효원균형교양',
  '효원창의교양': '효원창의교양',
  '교직과목': '교직과목',
  '타전공': '타전공',
}

const majorSpecificTypes = new Set<string>([
  '전공기초',
  '전공필수',
  '전공선택',
  'REQUIRED',
  'ELECTIVE',
  'MAJOR_REQUIRED',
  'MAJOR_ELECTIVE',
])

export function CourseTypeBadge({
  type,
  isInStudentMajor,
  showOriginalTypeForOtherMajor = false,
}: {
  type: CourseType
  isInStudentMajor?: boolean | null
  showOriginalTypeForOtherMajor?: boolean
}) {
  const isOtherMajor = isInStudentMajor === false && majorSpecificTypes.has(String(type))
  if (isOtherMajor && showOriginalTypeForOtherMajor) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
          {labels['타전공']}
        </span>
        <span className={[
          'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold',
          styles[String(type)] || 'bg-gray-50 text-gray-700 border-gray-200',
        ].join(' ')}>
          {labels[String(type)] || type}
        </span>
      </span>
    )
  }
  const visibleType = isOtherMajor
    ? '타전공'
    : type
  return (
    <span
      className={[
        'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        styles[visibleType as string] || 'bg-gray-50 text-gray-700 border-gray-200',
      ].join(' ')}
    >
      {labels[visibleType as string] || visibleType}
    </span>
  )
}
