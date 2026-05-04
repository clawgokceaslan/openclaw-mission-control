import type { CSSProperties } from 'react'
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
  const style = {
    '--avatar-size': `${size}px`,
    '--avatar-radius': `${radius}px`
  } as CSSProperties

  return (
    <span className={`${styles.avatar} ${className ?? ''}`} style={style}>
      {imageUrl ? <img src={imageUrl} alt={alt ?? `${name} avatar`} /> : <span aria-hidden="true">{initials}</span>}
    </span>
  )
}
