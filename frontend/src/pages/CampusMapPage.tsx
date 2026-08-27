import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Building2,
  Coffee,
  Filter,
  LocateFixed,
  Search,
  Utensils,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useLanguage } from '@/context/LanguageContext'
import { api } from '@/api'
import {
  loadNaverMaps,
  PNU_CENTER,
  type NaverInfoWindow,
  type NaverMap,
  type NaverMarker,
} from '@/lib/naverMaps'
import type { MapFacility } from '@/types/api'
import { distanceMeters, formatDistance } from '@/utils/geo'

const TYPE_FILTERS = ['All', 'Library', 'Cafeteria', 'Academic', 'Administrative', 'Dormitory', 'Student Life'] as const

function typeFilterLabelKey(type: (typeof TYPE_FILTERS)[number]): string {
  switch (type) {
    case 'All':
      return 'campusMap.filterAll'
    case 'Library':
      return 'campusMap.typeLibrary'
    case 'Cafeteria':
      return 'campusMap.typeCafeteria'
    case 'Academic':
      return 'campusMap.typeAcademic'
    case 'Administrative':
      return 'campusMap.typeAdministrative'
    case 'Dormitory':
      return 'campusMap.typeDormitory'
    case 'Student Life':
      return 'campusMap.typeStudentLife'
  }
}

function facilityIcon(type: string) {
  switch (type) {
    case 'Library':
      return BookOpen
    case 'Cafeteria':
      return Utensils
    case 'Student Life':
      return Coffee
    default:
      return Building2
  }
}

function getBuildingColor(buildingNumber?: string | null, type?: string): string {
  const bNo = buildingNumber ? buildingNumber.trim() : ''
  if (bNo) {
    const series = bNo.charAt(0)
    switch (series) {
      case '1':
      case '2':
        return '#dc2626' // Red (100 / 200 series)
      case '3':
        return '#d97706' // Amber / Gold (300 series)
      case '4':
      case '5':
        return '#16a34a' // Green (400 / 500 series)
      case '6':
        return '#0284c7' // Blue (600 series)
      case '7':
        return '#7e22ce' // Purple (700 series)
    }
  }

  switch (type) {
    case 'Library':
      return '#16a34a'
    case 'Cafeteria':
      return '#d97706'
    case 'Academic':
      return '#0284c7'
    case 'Administrative':
      return '#dc2626'
    case 'Dormitory':
      return '#7e22ce'
    default:
      return '#005bac'
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildMarkerHtml(facility: MapFacility): string {
  const color = getBuildingColor(facility.buildingNumber, facility.type)
  const rawLabel = facility.buildingNumber ? facility.buildingNumber.trim() : facility.name.slice(0, 3)
  const label = escapeHtml(rawLabel)

  return `<div style="
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: ${color};
    color: #ffffff;
    font-size: 11px;
    font-weight: 800;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 2px 7px;
    min-width: 26px;
    height: 22px;
    border-radius: 9999px;
    border: 1.5px solid #ffffff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    white-space: nowrap;
    cursor: pointer;
    line-height: 1;
  ">${label}</div>`
}

/**
 * Build the info-window content as real DOM nodes so the "view details"
 * button gets its click listener attached exactly once, directly on the
 * element. Unlike the previous `domready` + `document.querySelector`
 * approach this cannot race, stack duplicate listeners, or grab another
 * info window's button, and it never injects DB text as HTML.
 */
function buildInfoWindowContent(
  facility: MapFacility,
  viewDetailsLabel: string,
  onViewDetails: () => void,
): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'padding:10px 12px;min-width:160px;'

  const title = document.createElement('strong')
  title.style.cssText = 'display:block;font-size:13px;'
  title.textContent = facility.buildingNumber
    ? `[${facility.buildingNumber}] ${facility.name}`
    : facility.name
  wrapper.appendChild(title)

  if (facility.nameKo) {
    const nameKo = document.createElement('span')
    nameKo.style.cssText = 'display:block;font-size:12px;color:#475569;'
    nameKo.textContent = facility.nameKo
    wrapper.appendChild(nameKo)
  }

  const type = document.createElement('span')
  type.style.cssText = 'font-size:11px;color:#64748b;'
  type.textContent = facility.type
  wrapper.appendChild(type)

  const button = document.createElement('button')
  button.type = 'button'
  button.style.cssText =
    'display:block;margin-top:8px;color:#005bac;font-size:12px;font-weight:600;background:none;border:none;padding:0;cursor:pointer;'
  button.textContent = viewDetailsLabel
  button.addEventListener('click', (event) => {
    event.preventDefault()
    onViewDetails()
  })
  wrapper.appendChild(button)

  return wrapper
}

export function CampusMapPage() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<NaverMap | null>(null)
  const markersRef = useRef<
    Array<{
      facility: MapFacility
      marker: NaverMarker
      infoWindow: NaverInfoWindow
    }>
  >([])
  const activeInfoWindowRef = useRef<NaverInfoWindow | null>(null)
  const pendingOpenRef = useRef<{ listener: unknown; timer?: number } | null>(null)

  const [facilities, setFacilities] = useState<MapFacility[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapError, setMapError] = useState('')
  const [facilitiesError, setFacilitiesError] = useState('')
  const [loadingFacilities, setLoadingFacilities] = useState(true)
  const [mapReady, setMapReady] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>('All')
  const [showFilters, setShowFilters] = useState(false)
  const [showAllNearby, setShowAllNearby] = useState(false)
  const [origin, setOrigin] = useState(PNU_CENTER)

  const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID as string | undefined

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return facilities.filter((f) => {
      if (typeFilter !== 'All' && f.type !== typeFilter) return false
      if (!q) return true
      return (
        f.name.toLowerCase().includes(q) ||
        (f.nameKo ?? '').toLowerCase().includes(q) ||
        (f.buildingNumber ?? '').toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q)
      )
    })
  }, [facilities, query, typeFilter])

  const nearby = useMemo(() => {
    return [...filtered]
      .map((f) => ({
        facility: f,
        distance: distanceMeters(origin, { lat: f.latitude, lng: f.longitude }),
      }))
      .sort((a, b) => a.distance - b.distance)
  }, [filtered, origin])

  const nearbyVisible = showAllNearby ? nearby : nearby.slice(0, 3)

  const openInfoWindow = useCallback(
    (entry: { facility: MapFacility; marker: NaverMarker; infoWindow: NaverInfoWindow }) => {
      const map = mapInstanceRef.current
      if (!map) return
      if (activeInfoWindowRef.current === entry.infoWindow) return
      activeInfoWindowRef.current?.close()
      entry.infoWindow.open(map, entry.marker)
      activeInfoWindowRef.current = entry.infoWindow
    },
    [],
  )

  const focusFacility = useCallback(
    (facility: MapFacility) => {
      const naver = window.naver
      const map = mapInstanceRef.current
      if (!naver?.maps || !map) return

      const entry = markersRef.current.find((item) => item.facility.id === facility.id)
      if (!entry) return

      setSelectedId(facility.id)

      // Cancel any open scheduled by a previous focus before scheduling a new one.
      if (pendingOpenRef.current) {
        const { listener, timer } = pendingOpenRef.current
        if (listener && naver.maps.Event.removeListener) {
          naver.maps.Event.removeListener(listener)
        }
        if (timer !== undefined) {
          window.clearTimeout(timer)
        }
        pendingOpenRef.current = null
      }

      const position = new naver.maps.LatLng(facility.latitude, facility.longitude)
      const center = map.getCenter()
      const settled =
        Math.abs(center.lat() - facility.latitude) < 1e-6 &&
        Math.abs(center.lng() - facility.longitude) < 1e-6 &&
        map.getZoom() >= 16

      // Already centered on this building at detail zoom — open immediately.
      if (settled) {
        openInfoWindow(entry)
        return
      }

      // Otherwise pan/zoom first and open once the animation settles, so the
      // box is anchored to the marker's final on-screen position instead of
      // being clipped or misplaced mid-animation.
      map.panTo(position)
      map.setZoom(16, true)

      if (naver.maps.Event.once) {
        const listener = naver.maps.Event.once(map, 'idle', () => openInfoWindow(entry))
        pendingOpenRef.current = { listener }
      } else {
        const timer = window.setTimeout(() => openInfoWindow(entry), 350)
        pendingOpenRef.current = { listener: null, timer }
      }
    },
    [openInfoWindow],
  )

  const recenter = useCallback(() => {
    const naver = window.naver
    const map = mapInstanceRef.current
    if (!naver?.maps || !map) return
    map.panTo(new naver.maps.LatLng(PNU_CENTER.lat, PNU_CENTER.lng))
    map.setZoom(15, true)
    setOrigin(PNU_CENTER)
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        /* keep campus center */
      },
      { enableHighAccuracy: false, timeout: 5000 },
    )
  }, [])

  useEffect(() => {
    setLoadingFacilities(true)
    setFacilitiesError('')

    api
      .getMapFacilities()
      .then(setFacilities)
      .catch((err) =>
        setFacilitiesError(err instanceof Error ? err.message : t('campusLife.mapFacilitiesError')),
      )
      .finally(() => setLoadingFacilities(false))
  }, [t])

  useEffect(() => {
    if (!clientId) {
      setMapError(t('campusLife.mapMissingKey'))
      return
    }

    let cancelled = false

    loadNaverMaps(clientId)
      .then(() => {
        if (!cancelled) setMapReady(true)
      })
      .catch(() => {
        if (!cancelled) setMapError(t('campusLife.mapLoadError'))
      })

    return () => {
      cancelled = true
    }
  }, [clientId, t])

  useEffect(() => {
    const naver = window.naver
    if (!mapReady || !naver?.maps || !mapRef.current || facilities.length === 0) return

    // Clear previous map instance to avoid blink / stacked maps on re-render
    if (mapRef.current) {
      mapRef.current.innerHTML = ''
    }

    const center = new naver.maps.LatLng(PNU_CENTER.lat, PNU_CENTER.lng)
    const map = new naver.maps.Map(mapRef.current, { center, zoom: 15 })
    mapInstanceRef.current = map

    activeInfoWindowRef.current = null
    pendingOpenRef.current = null
    markersRef.current = []

    facilities.forEach((facility) => {
      const position = new naver.maps.LatLng(facility.latitude, facility.longitude)
      const marker = new naver.maps.Marker({
        position,
        map,
        title: facility.buildingNumber ? `[${facility.buildingNumber}] ${facility.name}` : facility.name,
        icon: {
          content: buildMarkerHtml(facility),
          anchor: new naver.maps.Point(16, 11),
        },
      })

      const infoWindow = new naver.maps.InfoWindow({
        content: buildInfoWindowContent(facility, t('campusMap.viewDetails'), () =>
          navigate(`/map/${facility.id}`),
        ),
      })

      naver.maps.Event.addListener(marker, 'click', () => focusFacility(facility))
      markersRef.current.push({ facility, marker, infoWindow })
    })
  }, [facilities, focusFacility, mapReady, navigate, t])

  useEffect(() => {
    const filteredIds = new Set(filtered.map((f) => f.id))
    markersRef.current.forEach(({ facility, marker }) => {
      marker.setVisible(filteredIds.has(facility.id))
    })
  }, [filtered])

  const error = mapError || facilitiesError

  return (
    <div>
      <PageHeader title={t('nav.campusMap')} />
      <div className="space-y-4 px-4 pb-6 pt-2">
        <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 shadow-sm ring-1 ring-black/5">
          <Search className="h-4 w-4 shrink-0 text-pnu-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('campusMap.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-pnu-text outline-none placeholder:text-pnu-muted"
          />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`rounded-lg p-1.5 transition ${showFilters ? 'bg-pnu-blue/10 text-pnu-blue' : 'text-pnu-muted'}`}
            aria-label={t('campusMap.filter')}
          >
            <Filter className="h-4 w-4" />
          </button>
        </div>

        {showFilters ? (
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
                  typeFilter === type
                    ? 'bg-pnu-blue text-white'
                    : 'bg-white text-pnu-muted ring-1 ring-black/5'
                }`}
              >
                {t(typeFilterLabelKey(type))}
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-[18px] bg-white p-4 text-sm leading-relaxed text-pnu-muted shadow-sm ring-1 ring-black/5">
            {error}
          </div>
        ) : null}

        {loadingFacilities ? (
          <p className="text-sm text-pnu-muted">{t('common.loading')}</p>
        ) : null}

        <div className="relative">
          <div
            ref={mapRef}
            className="h-[340px] overflow-hidden rounded-[22px] bg-slate-100 shadow-sm ring-1 ring-black/5"
          />
          <button
            type="button"
            onClick={recenter}
            className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-pnu-blue shadow-md ring-1 ring-black/5"
            aria-label={t('campusMap.recenter')}
          >
            <LocateFixed className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[15px] font-bold text-pnu-text">{t('campusMap.nearby')}</h2>
            {nearby.length > 3 ? (
              <button
                type="button"
                onClick={() => setShowAllNearby((v) => !v)}
                className="text-[13px] font-semibold text-pnu-blue"
              >
                {showAllNearby ? t('campusMap.showLess') : t('campusMap.viewAll')}
              </button>
            ) : null}
          </div>

          {nearbyVisible.length === 0 && !loadingFacilities ? (
            <div className="flex items-center gap-2 rounded-[18px] bg-white p-4 text-sm text-pnu-muted shadow-sm ring-1 ring-black/5">
              <X className="h-4 w-4" />
              {t('campusMap.noResults')}
            </div>
          ) : null}

          <div className="space-y-2">
            {nearbyVisible.map(({ facility, distance }) => {
              const Icon = facilityIcon(facility.type)
              const isSelected = selectedId === facility.id
              const color = getBuildingColor(facility.buildingNumber, facility.type)
              return (
                <button
                  key={facility.id}
                  type="button"
                  onClick={() => navigate(`/map/${facility.id}`)}
                  className={`flex w-full items-center gap-3 rounded-[18px] bg-white p-3.5 text-left shadow-sm ring-1 transition active:scale-[0.99] ${
                    isSelected ? 'ring-pnu-blue/40' : 'ring-black/5'
                  }`}
                >
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `${color}18`, color }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-pnu-text">
                      {facility.buildingNumber ? `[${facility.buildingNumber}] ` : ''}{facility.name}
                    </p>
                    <p className="truncate text-[12px] text-pnu-muted">
                      {facility.nameKo ? `${facility.nameKo} • ` : ''}{facility.type}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] font-semibold text-pnu-muted">
                    {formatDistance(distance)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
