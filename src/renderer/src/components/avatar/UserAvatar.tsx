import { useEffect, useState, type CSSProperties } from 'react'
import styles from './UserAvatar.module.scss'

function initialsFromName(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'MC'
  )
}

interface UserAvatarProps {
  name: string
  imageUrl?: string | null
  alt?: string
  size?: number
  radius?: number
  className?: string
}

export function UserAvatar({ name, imageUrl, alt, size = 36, radius = 12, className }: UserAvatarProps) {
  const initials = initialsFromName(name)
  const [imageFailed, setImageFailed] = useState(false)
  const style = {
    '--avatar-size': `${size}px`,
    '--avatar-radius': `${radius}px`
  } as CSSProperties

  useEffect(() => {
    setImageFailed(false)
  }, [imageUrl])

  return (
    <span className={`${styles.avatar} ${className ?? ''}`} style={style}>
      {imageUrl && !imageFailed ? (
        <img src={imageUrl} alt={alt ?? `${name} avatar`} onError={() => setImageFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  )
}
