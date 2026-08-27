const NAVER_MAP_SCRIPT_ID = 'naver-map-script'

export const PNU_CENTER = { lat: 35.2338, lng: 129.0794 }

export interface NaverMap {
  setCenter(latlng: any): void
  setZoom(zoom: number, effect?: boolean): void
  panTo(latlng: any): void
  getCenter(): { lat(): number; lng(): number }
  getZoom(): number
}

export interface NaverMarker {
  setMap(map: NaverMap | null): void
  setVisible(visible: boolean): void
  setPosition?(latlng: any): void
}

export interface NaverInfoWindow {
  open(map: NaverMap, marker: NaverMarker): void
  close(): void
}

export interface NaverGeocodeAddress {
  roadAddress: string
  jibunAddress: string
  englishAddress: string
  x: string // longitude
  y: string // latitude
}

export interface NaverGeocodeResponse {
  v2: {
    addresses: NaverGeocodeAddress[]
  }
}

export interface NaverMapsApi {
  maps: {
    LatLng: new (lat: number, lng: number) => any
    Point: new (x: number, y: number) => any
    Map: new (
      element: HTMLElement,
      options: { center: any; zoom: number; mapTypeId?: any }
    ) => NaverMap
    Marker: new (options: {
      position: any
      title?: string
      map?: NaverMap
      icon?: { content: string; anchor?: any }
    }) => NaverMarker
    InfoWindow: new (options: { content: string | HTMLElement; anchorSkew?: boolean }) => NaverInfoWindow
    Event: {
      addListener: (
        target: NaverMap | NaverMarker | NaverInfoWindow,
        type: string,
        handler: () => void,
      ) => unknown
      once?: (
        target: NaverMap | NaverMarker | NaverInfoWindow,
        type: string,
        handler: () => void,
      ) => unknown
      removeListener?: (listener: unknown) => void
    }
    MapTypeId: {
      NORMAL: any
    }
    Service?: {
      geocode: (
        options: { query: string },
        callback: (status: number, response: NaverGeocodeResponse) => void
      ) => void
      Status: {
        OK: number
        ERROR: number
      }
    }
  }
}

declare global {
  interface Window {
    naver?: NaverMapsApi
  }
}

export function loadNaverMaps(appKey: string): Promise<NaverMapsApi> {
  return new Promise((resolve, reject) => {
    if (window.naver?.maps) {
      resolve(window.naver)
      return
    }

    const existingScript = document.getElementById(NAVER_MAP_SCRIPT_ID) as HTMLScriptElement | null
    if (existingScript) {
      // Script already injected; wait for maps API if still loading
      const started = Date.now()
      const wait = () => {
        if (window.naver?.maps) {
          resolve(window.naver)
          return
        }
        if (Date.now() - started > 10000) {
          reject(new Error('Naver Maps SDK timed out — check Client ID and Web Service URL'))
          return
        }
        window.setTimeout(wait, 50)
      }
      wait()
      return
    }

    const script = document.createElement('script')
    script.id = NAVER_MAP_SCRIPT_ID
    // Naver Maps API v3 submodule system: include submodules=geocoder
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(appKey)}&submodules=geocoder`
    script.async = true

    script.onload = () => {
      if (!window.naver?.maps) {
        reject(new Error('Naver Maps SDK loaded but maps API is unavailable'))
        return
      }
      resolve(window.naver)
    }

    script.onerror = () =>
      reject(new Error('Failed to load Naver Maps SDK — check Client ID / network'))

    document.head.appendChild(script)
  })
}

/**
 * Use Naver Maps Geocoder submodule (naver.maps.Service.geocode) to perform address/keyword geocoding.
 */
export function geocodeAddress(query: string): Promise<{ lat: number; lng: number; roadAddress?: string } | null> {
  return new Promise((resolve) => {
    const naver = window.naver
    const service = naver?.maps?.Service
    if (!service?.geocode) {
      resolve(null)
      return
    }

    service.geocode({ query }, (status, response) => {
      if (
        status === service.Status.OK &&
        response?.v2?.addresses &&
        response.v2.addresses.length > 0
      ) {
        const item = response.v2.addresses[0]
        const lng = parseFloat(item.x)
        const lat = parseFloat(item.y)
        if (!isNaN(lat) && !isNaN(lng)) {
          resolve({
            lat,
            lng,
            roadAddress: item.roadAddress || item.jibunAddress,
          })
        } else {
          resolve(null)
        }
      } else {
        resolve(null)
      }
    })
  })
}
