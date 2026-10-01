/** Placeholder while a page hands off to the right one (presale ↔ token). */
export function Redirecting({ text }: { text: string }) {
  return (
    <div role="status" className="muted" style={{ display: 'grid', placeItems: 'center', padding: '96px 16px' }}>
      {text}
    </div>
  )
}
