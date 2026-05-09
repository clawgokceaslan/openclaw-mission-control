import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { DEFAULT_METADATA, keywordsContent, metadataForPath, pageTitle } from '@renderer/utils/routeMetadata'

function setNamedMeta(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('name', name)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

function setPropertyMeta(property: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('property', property)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

export function useRouteMetadata() {
  const location = useLocation()

  useEffect(() => {
    const metadata = metadataForPath(location.pathname)
    const title = pageTitle(metadata)
    const keywords = keywordsContent(metadata)
    const url = `${window.location.origin}${location.pathname}${location.search}`

    document.title = title
    setNamedMeta('description', metadata.description)
    setNamedMeta('keywords', keywords)
    setNamedMeta('application-name', DEFAULT_METADATA.title)
    setNamedMeta('apple-mobile-web-app-title', DEFAULT_METADATA.title)
    setNamedMeta('twitter:title', title)
    setNamedMeta('twitter:description', metadata.description)
    setNamedMeta('twitter:image', 'icons/icon-512x512.png')
    setPropertyMeta('og:site_name', DEFAULT_METADATA.title)
    setPropertyMeta('og:title', title)
    setPropertyMeta('og:description', metadata.description)
    setPropertyMeta('og:url', url)
    setPropertyMeta('og:image', 'icons/icon-512x512.png')
  }, [location.pathname, location.search])
}
