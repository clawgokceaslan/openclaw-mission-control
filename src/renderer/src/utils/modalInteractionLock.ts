const MODAL_INTERACTIVE_CLASS = 'omc-modal-interactive'
const MODAL_INTERACTIVE_LOCKS = 'omcModalInteractiveLocks'

export function lockModalInteractionRegion(): () => void {
  if (typeof document === 'undefined') return () => {}
  const body = document.body
  const current = Number(body.dataset[MODAL_INTERACTIVE_LOCKS] ?? '0')
  body.dataset[MODAL_INTERACTIVE_LOCKS] = String(current + 1)
  body.classList.add(MODAL_INTERACTIVE_CLASS)

  return () => {
    const next = Math.max(0, Number(body.dataset[MODAL_INTERACTIVE_LOCKS] ?? '1') - 1)
    if (next === 0) {
      delete body.dataset[MODAL_INTERACTIVE_LOCKS]
      body.classList.remove(MODAL_INTERACTIVE_CLASS)
      return
    }
    body.dataset[MODAL_INTERACTIVE_LOCKS] = String(next)
  }
}
