import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  LuBadgeCheck,
  LuCamera,
  LuCheck,
  LuKeyRound,
  LuMail,
  LuMonitor,
  LuMoon,
  LuRotateCcw,
  LuSave,
  LuSun,
  LuTrash2,
  LuUserRound,
  LuX,
  LuZoomIn
} from 'react-icons/lu'
import type { User } from '@shared/types/entities'
import { UserAvatar } from '@renderer/components/avatar/UserAvatar'
import { resolveUserAvatarUrl } from '@renderer/components/avatar/avatarUrl'
import { useAuth } from '@renderer/providers/auth/auth-state'
import { useTheme, type ThemeMode } from '@renderer/providers/theme/theme-state'
import styles from './ProfilePage.module.scss'

const TITLE_OPTIONS: User['role'][] = ['owner', 'admin', 'member']
const CROP_BOX_SIZE = 280
const AVATAR_OUTPUT_SIZE = 256
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function splitName(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

interface ImageSize {
  width: number
  height: number
}

interface CropOffset {
  x: number
  y: number
}

function getBaseScale(imageSize: ImageSize): number {
  return Math.max(CROP_BOX_SIZE / imageSize.width, CROP_BOX_SIZE / imageSize.height)
}

function boundOffset(offset: CropOffset, imageSize: ImageSize, zoom: number): CropOffset {
  const scale = getBaseScale(imageSize) * zoom
  const maxX = Math.max(0, (imageSize.width * scale - CROP_BOX_SIZE) / 2)
  const maxY = Math.max(0, (imageSize.height * scale - CROP_BOX_SIZE) / 2)
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y))
  }
}

function cropImageToDataUrl(image: HTMLImageElement, imageSize: ImageSize, zoom: number, offset: CropOffset): string {
  const scale = getBaseScale(imageSize) * zoom
  const sourceSize = CROP_BOX_SIZE / scale
  const sourceX = (imageSize.width * scale - CROP_BOX_SIZE) / (2 * scale) - offset.x / scale
  const sourceY = (imageSize.height * scale - CROP_BOX_SIZE) / (2 * scale) - offset.y / scale
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_OUTPUT_SIZE
  canvas.height = AVATAR_OUTPUT_SIZE
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas is not available')
  }

  context.drawImage(
    image,
    Math.max(0, Math.min(imageSize.width - sourceSize, sourceX)),
    Math.max(0, Math.min(imageSize.height - sourceSize, sourceY)),
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_OUTPUT_SIZE,
    AVATAR_OUTPUT_SIZE
  )

  return canvas.toDataURL('image/png')
}

function loadImage(file: File): Promise<{ dataUrl: string; image: HTMLImageElement; size: ImageSize }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The selected file could not be read.'))
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) {
        reject(new Error('The selected file could not be read.'))
        return
      }

      const image = new Image()
      image.onload = () => resolve({ dataUrl, image, size: { width: image.naturalWidth, height: image.naturalHeight } })
      image.onerror = () => reject(new Error('The selected image could not be loaded.'))
      image.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

export function ProfilePage() {
  const { user, updateProfile, updateAvatar, removeAvatar: removeProfileAvatar, changePassword, refresh } = useAuth()
  const { mode, resolvedMode, paletteId, backgroundId, palettes, backgrounds, setMode, setPaletteId, setBackgroundId } = useTheme()
  const initialName = useMemo(() => splitName(user?.name), [user?.name])
  const [firstName, setFirstName] = useState(initialName.firstName)
  const [lastName, setLastName] = useState(initialName.lastName)
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState<User['role']>(user?.role ?? 'member')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordPending, setPasswordPending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cropImageRef = useRef<HTMLImageElement | null>(null)
  const dragStartRef = useRef<{ pointerId: number; startX: number; startY: number; offset: CropOffset } | null>(null)
  const [avatarStatus, setAvatarStatus] = useState<string | null>(null)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [avatarPending, setAvatarPending] = useState(false)
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null)
  const [cropImageSize, setCropImageSize] = useState<ImageSize | null>(null)
  const [cropOffset, setCropOffset] = useState<CropOffset>({ x: 0, y: 0 })
  const [cropZoom, setCropZoom] = useState(1)
  const [croppedPreview, setCroppedPreview] = useState<string | null>(null)
  const fullName = `${firstName} ${lastName}`.trim() || user?.name?.trim() || 'Mission Operator'
  const accountEmail = email.trim() || user?.email || '-'
  const activeAvatarUrl = croppedPreview ?? resolveUserAvatarUrl(user?.avatarUrl)
  const displayScale = cropImageSize ? getBaseScale(cropImageSize) * cropZoom : 1
  const cropImageStyle = cropImageSize
    ? ({
        width: `${cropImageSize.width * displayScale}px`,
        height: `${cropImageSize.height * displayScale}px`,
        left: `calc(50% + ${cropOffset.x}px)`,
        top: `calc(50% + ${cropOffset.y}px)`
      } as CSSProperties)
    : undefined
  const modeOptions: Array<{ value: ThemeMode; label: string; icon: typeof LuMonitor }> = [
    { value: 'system', label: 'Sistem', icon: LuMonitor },
    { value: 'light', label: 'Açık', icon: LuSun },
    { value: 'dark', label: 'Koyu', icon: LuMoon }
  ]

  useEffect(() => {
    setFirstName(initialName.firstName)
    setLastName(initialName.lastName)
    setEmail(user?.email ?? '')
    setRole(user?.role ?? 'member')
  }, [initialName.firstName, initialName.lastName, user?.email, user?.role])

  useEffect(() => {
    if (!cropImageRef.current || !cropImageSize) {
      setCroppedPreview(null)
      return
    }

    try {
      setCroppedPreview(cropImageToDataUrl(cropImageRef.current, cropImageSize, cropZoom, cropOffset))
    } catch (previewError) {
      setAvatarError(previewError instanceof Error ? previewError.message : 'Preview could not be generated.')
    }
  }, [cropImageSize, cropOffset, cropZoom])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedFirstName = firstName.trim()
    const trimmedLastName = lastName.trim()

    if (!trimmedFirstName && !trimmedLastName) {
      setError('Ad veya soyad alanlarından en az biri dolu olmalıdır.')
      setStatus(null)
      return
    }

    setPending(true)
    setError(null)
    setStatus(null)

    const response = await updateProfile(trimmedFirstName, trimmedLastName, {
      email: email.trim(),
      role
    })
    setPending(false)

    if (!response.ok) {
      setError(response.message ?? 'Profil güncellenemedi')
      return
    }

    await refresh()
    setStatus('Profil bilgileri güncellendi.')
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setPasswordStatus(null)
    setPasswordError(null)

    if (newPassword.length < 8) {
      setPasswordError('Şifre en az 8 karakter olmalıdır.')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Şifre onayı eşleşmiyor.')
      return
    }

    setPasswordPending(true)
    const response = await changePassword(newPassword, confirmPassword)
    setPasswordPending(false)

    if (!response.ok) {
      setPasswordError(response.message ?? 'Şifre güncellenemedi.')
      return
    }

    setNewPassword('')
    setConfirmPassword('')
    setPasswordStatus('Şifre güncellendi. Oturumunuz açık kalacak.')
  }

  const resetCrop = () => {
    setCropImageUrl(null)
    setCropImageSize(null)
    setCropOffset({ x: 0, y: 0 })
    setCropZoom(1)
    setCroppedPreview(null)
    cropImageRef.current = null
    dragStartRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setAvatarStatus(null)
    setAvatarError(null)

    if (!file) return

    if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      setAvatarError('Choose a PNG, JPG, WEBP, or GIF image.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    try {
      const loaded = await loadImage(file)
      cropImageRef.current = loaded.image
      setCropImageUrl(loaded.dataUrl)
      setCropImageSize(loaded.size)
      setCropOffset({ x: 0, y: 0 })
      setCropZoom(1)
      setAvatarStatus('Image loaded. Drag the crop area and adjust zoom before saving.')
    } catch (loadError) {
      setAvatarError(loadError instanceof Error ? loadError.message : 'The selected image could not be loaded.')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onCropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cropImageSize) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: cropOffset
    }
  }

  const onCropPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current
    if (!dragStart || dragStart.pointerId !== event.pointerId || !cropImageSize) return
    const nextOffset = {
      x: dragStart.offset.x + event.clientX - dragStart.startX,
      y: dragStart.offset.y + event.clientY - dragStart.startY
    }
    setCropOffset(boundOffset(nextOffset, cropImageSize, cropZoom))
  }

  const stopCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId === event.pointerId) dragStartRef.current = null
  }

  const onZoomChange = (nextZoom: number) => {
    if (!cropImageSize) return
    setCropZoom(nextZoom)
    setCropOffset((current) => boundOffset(current, cropImageSize, nextZoom))
  }

  const onCropKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!cropImageSize) return
    const movement = event.shiftKey ? 18 : 6
    const keyOffsets: Record<string, CropOffset> = {
      ArrowUp: { x: 0, y: movement },
      ArrowDown: { x: 0, y: -movement },
      ArrowLeft: { x: movement, y: 0 },
      ArrowRight: { x: -movement, y: 0 }
    }
    const nextMovement = keyOffsets[event.key]
    if (!nextMovement) return
    event.preventDefault()
    setCropOffset((current) =>
      boundOffset({ x: current.x + nextMovement.x, y: current.y + nextMovement.y }, cropImageSize, cropZoom)
    )
  }

  const buildCroppedAvatarDataUrl = (): string | null => {
    if (!cropImageRef.current || !cropImageSize) return null
    return cropImageToDataUrl(cropImageRef.current, cropImageSize, cropZoom, cropOffset)
  }

  const saveCroppedAvatar = async () => {
    let nextAvatarDataUrl: string | null = null

    try {
      nextAvatarDataUrl = buildCroppedAvatarDataUrl()
    } catch (previewError) {
      setAvatarError(previewError instanceof Error ? previewError.message : 'Preview could not be generated.')
      return
    }

    if (!nextAvatarDataUrl) {
      setAvatarError('Choose an image before saving.')
      return
    }

    setCroppedPreview(nextAvatarDataUrl)
    setAvatarPending(true)
    const response = await updateAvatar(nextAvatarDataUrl)
    setAvatarPending(false)
    if (!response.ok) {
      setAvatarError(response.message ?? 'Avatar could not be saved.')
      return
    }
    resetCrop()
    setAvatarStatus('Avatar saved and published through the web endpoint.')
    setAvatarError(null)
  }

  const removeAvatar = async () => {
    setAvatarPending(true)
    const response = await removeProfileAvatar()
    setAvatarPending(false)
    if (!response.ok) {
      setAvatarError(response.message ?? 'Avatar could not be removed.')
      return
    }
    resetCrop()
    setAvatarStatus('Avatar removed. Initials are shown again.')
    setAvatarError(null)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Profil</h1>
          <p>Kullanıcı bilgilerinizi ve görünen adınızı yönetin.</p>
        </div>
      </header>

      <div className={styles.profileGrid}>
        <aside className={styles.summaryPanel}>
          <div className={styles.avatarWrap}>
            <UserAvatar name={fullName} imageUrl={activeAvatarUrl} alt={`${fullName} avatar`} size={56} radius={15} className={styles.avatar} />
          </div>
          <div className={styles.summaryIdentity}>
            <h2>{fullName}</h2>
            <p>{accountEmail}</p>
          </div>
          <div className={styles.summaryMeta}>
            <span className={styles.roleBadge}>{role}</span>
            <span>Kullanıcı profili</span>
          </div>
        </aside>

        <div className={styles.profileMain}>
          <section className={styles.formPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Avatar</h2>
                <p>Saved locally on this device and shown in the header.</p>
              </div>
            </div>

            <div className={styles.avatarEditor}>
              <div className={styles.avatarControls}>
                <UserAvatar name={fullName} imageUrl={activeAvatarUrl} alt={`${fullName} avatar preview`} size={84} radius={20} />
                <div className={styles.avatarActions}>
                  <input ref={fileInputRef} type="file" accept={SUPPORTED_IMAGE_TYPES.join(',')} onChange={onFileChange} />
                  <button type="button" onClick={() => fileInputRef.current?.click()}>
                    <LuCamera size={15} />
                    {user?.avatarUrl ? 'Replace image' : 'Choose image'}
                  </button>
                  {cropImageUrl ? (
                    <button type="button" className={styles.secondaryButton} onClick={resetCrop}>
                      <LuX size={15} />
                      Cancel
                    </button>
                  ) : null}
                  {user?.avatarUrl ? (
                    <button type="button" className={styles.dangerButton} onClick={removeAvatar}>
                      <LuTrash2 size={15} />
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>

              {cropImageUrl && cropImageSize ? (
                <div className={styles.cropGrid}>
                  <div className={styles.cropWorkspace}>
                    <div
                      className={styles.cropBox}
                      role="application"
                      aria-label="Square avatar crop area. Drag to position the image."
                      tabIndex={0}
                      onKeyDown={onCropKeyDown}
                      onPointerDown={onCropPointerDown}
                      onPointerMove={onCropPointerMove}
                      onPointerUp={stopCropDrag}
                      onPointerCancel={stopCropDrag}
                    >
                      <img src={cropImageUrl} alt="" draggable={false} style={cropImageStyle} />
                    </div>
                    <label className={styles.zoomControl}>
                      <span>
                        <LuZoomIn size={15} />
                        Zoom
                      </span>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.01"
                        value={cropZoom}
                        onChange={(event) => onZoomChange(Number(event.target.value))}
                        aria-label="Avatar crop zoom"
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        setCropOffset({ x: 0, y: 0 })
                        onZoomChange(1)
                      }}
                    >
                      <LuRotateCcw size={15} />
                      Reset crop
                    </button>
                  </div>

                  <div className={styles.cropPreviewPanel}>
                    <span>Preview</span>
                    <UserAvatar name={fullName} imageUrl={croppedPreview} alt="Cropped avatar preview" size={96} radius={24} />
                    <button type="button" onClick={saveCroppedAvatar} disabled={avatarPending}>
                      <LuSave size={15} />
                      {avatarPending ? 'Saving...' : 'Save avatar'}
                    </button>
                  </div>
                </div>
              ) : null}

              {avatarError ? <p className={styles.error}>{avatarError}</p> : null}
              {avatarStatus ? <p className={styles.success}>{avatarStatus}</p> : null}
            </div>
          </section>

          <section className={styles.formPanel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Görünüm</h2>
                <p>Tema, palet ve arka plan bu cihazda saklanır.</p>
              </div>
            </div>

            <div className={styles.appearanceGrid}>
              <div className={styles.settingBlock}>
                <div className={styles.settingCopy}>
                  <span className={styles.settingLabel}>Mod</span>
                  <p className={styles.settingHint}>
                    {mode === 'system'
                      ? `Sistem kullanılıyor: ${resolvedMode === 'dark' ? 'koyu' : 'açık'}`
                      : `${resolvedMode === 'dark' ? 'Koyu' : 'Açık'} mod kullanılıyor`}
                  </p>
                </div>
                <div className={styles.modeSegment}>
                  {modeOptions.map((option) => {
                    const Icon = option.icon
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={mode === option.value ? styles.modeActive : undefined}
                        onClick={() => setMode(option.value)}
                        aria-pressed={mode === option.value}
                        title={`${option.label} modu kullan`}
                      >
                        <Icon size={15} />
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className={styles.settingBlock}>
                <div className={styles.settingCopy}>
                  <span className={styles.settingLabel}>Palet</span>
                  <p>Yüzey, vurgu, kenarlık ve kontrol renklerini belirler.</p>
                </div>
                <div className={styles.paletteRow}>
                  {palettes.map((palette) => (
                    <button
                      key={palette.id}
                      type="button"
                      className={paletteId === palette.id ? styles.paletteActive : undefined}
                      style={{ '--palette-color': palette.swatch } as CSSProperties}
                      onClick={() => setPaletteId(palette.id)}
                      aria-label={`${palette.name} paletini kullan`}
                      aria-pressed={paletteId === palette.id}
                      title={palette.name}
                    >
                      {paletteId === palette.id ? <LuCheck size={16} /> : null}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.settingBlock}>
                <div className={styles.settingCopy}>
                  <span className={styles.settingLabel}>Arka plan</span>
                  <p>Uygulama canvas davranışını belirler.</p>
                </div>
                <div className={styles.backgroundRow}>
                  {backgrounds.map((background) => (
                    <button
                      key={background.id}
                      type="button"
                      className={backgroundId === background.id ? styles.backgroundActive : undefined}
                      style={{ '--background-preview': background[resolvedMode] } as CSSProperties}
                      onClick={() => setBackgroundId(background.id)}
                      aria-label={`${background.name} arka planını kullan`}
                      aria-pressed={backgroundId === background.id}
                      title={background.name}
                    >
                      {backgroundId === background.id ? <LuCheck size={15} /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <form className={styles.formPanel} onSubmit={submit}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Hesap Bilgileri</h2>
                <p>Bu bilgiler üst barda ve çalışma alanı kayıtlarında görünür.</p>
              </div>
            </div>

            <div className={styles.formGrid}>
              <label>
                <span>Ad</span>
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
              </label>
              <label>
                <span>Soyad</span>
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} />
              </label>
              <label>
                <span>Email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
              <label>
                <span>Title</span>
                <select value={role} onChange={(event) => setRole(event.target.value as User['role'])}>
                  {TITLE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <section className={styles.readonlySection} aria-label="Read-only account details">
              <div className={styles.readonlyHeader}>
                <h3>Account Details</h3>
                <p>Reference information shown by the application.</p>
              </div>
              <div className={styles.readonlyGrid}>
                <div className={styles.infoRow}>
                  <LuMail size={16} />
                  <div>
                    <span>E-posta</span>
                    <strong>{accountEmail}</strong>
                  </div>
                </div>
                <div className={styles.infoRow}>
                  <LuBadgeCheck size={16} />
                  <div>
                    <span>Title</span>
                    <strong>{role}</strong>
                  </div>
                </div>
                <div className={styles.infoRow}>
                  <LuUserRound size={16} />
                  <div>
                    <span>Kullanıcı ID</span>
                    <strong>{user?.id ?? '-'}</strong>
                  </div>
                </div>
              </div>
            </section>

            {error ? <p className={styles.error}>{error}</p> : null}
            {status ? <p className={styles.success}>{status}</p> : null}

            <footer className={styles.footer}>
              <button type="submit" disabled={pending}>
                <LuSave size={16} />
                {pending ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </footer>
          </form>

          <form className={styles.formPanel} onSubmit={submitPassword}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Şifre</h2>
                <p>Mevcut oturumla yeni şifrenizi belirleyin.</p>
              </div>
            </div>

            <div className={styles.formGrid}>
              <label>
                <span>Yeni şifre</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <label>
                <span>Şifre onayı</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
            </div>

            {passwordError ? <p className={styles.error}>{passwordError}</p> : null}
            {passwordStatus ? <p className={styles.success}>{passwordStatus}</p> : null}

            <footer className={styles.footer}>
              <button type="submit" disabled={passwordPending || !newPassword || !confirmPassword}>
                <LuKeyRound size={16} />
                {passwordPending ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
              </button>
            </footer>
          </form>
        </div>
      </div>
    </section>
  )
}
